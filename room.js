// room.js

const BACKEND = (location.hostname.includes('localhost'))
  ? 'http://localhost:3000'
  : 'https://kino-fhwp.onrender.com';

const socket = io(BACKEND, {
  path: '/socket.io',
  transports: ['websocket']
});

const params = new URLSearchParams(location.search);
const roomId = params.get('roomId');
if (!roomId) {
  alert('Не указан ID комнаты.');
  location.href = 'index.html';
}

const playerWrapper = document.getElementById('playerWrapper');
const backLink      = document.getElementById('backLink');
const messagesBox   = document.getElementById('messages');
const membersList   = document.getElementById('membersList');
const msgInput      = document.getElementById('msgInput');
const sendBtn       = document.getElementById('sendBtn');

let player, blocker;
let isSeeking = false, isRemoteAction = false;
let lastUpdate = 0;
let ownerId = null;
let iAmOwner = false;
let myUserId = null;
let initialSync = null;
let syncTimeout = null;
let controlsLocked = false;  // флаг блокировки управления

// --- Обновление owner_id в БД ---
async function setOwnerIdInDb(roomId, ownerId) {
  try {
    await fetch(`${BACKEND}/api/rooms/${roomId}/set_owner`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner_id: ownerId })
    });
  } catch (err) {
    console.warn('[setOwnerIdInDb]', err);
  }
}

function updateOwnerState(newOwnerId) {
  if (newOwnerId) {
    ownerId = newOwnerId;
  } else if (!ownerId && myUserId) {
    ownerId = myUserId;
    setOwnerIdInDb(roomId, ownerId);
  }
  iAmOwner = (myUserId === ownerId);
}

// --- Отправка действий owner-а ---
function emitPlayerAction(paused) {
  socket.emit('player_action', {
    roomId,
    position:  player.currentTime,
    is_paused: paused,
    speed:     player.playbackRate,
    updatedAt: Date.now(),
    userId:    myUserId
  });
}

// --- Подключаемся и запрашиваем стейт ---
socket.on('connect', () => {
  myUserId = socket.id;
  socket.emit('join', { roomId, userData: { id: myUserId, first_name: 'Гость' } });
  socket.emit('request_state', { roomId });
  fetchRoom();
});

// === Участники и чат ===
socket.on('members', ms => {
  membersList.innerHTML =
    `<div class="chat-members-label">Участники (${ms.length}):</div>
     <ul>${ms.map(m=>`<li>${m.user_id}</li>`).join('')}</ul>`;
});
socket.on('history', data => {
  messagesBox.innerHTML = '';
  data.forEach(m=>appendMessage(m.author,m.text));
});
socket.on('chat_message', m => appendMessage(m.author,m.text));
socket.on('system_message', msg => msg?.text && appendSystemMessage(msg.text));

sendBtn.addEventListener('click', sendMessage);
msgInput.addEventListener('keydown', e => e.key==='Enter'&&sendMessage());
function sendMessage(){
  const t = msgInput.value.trim();
  if(!t) return;
  socket.emit('chat_message',{ roomId, author:'Гость', text:t });
  msgInput.value='';
}

// --- Синхронизация ---
function debouncedSync(pos, paus, time, oid){
  if(syncTimeout) clearTimeout(syncTimeout);
  syncTimeout = setTimeout(()=>{
    syncPlayer(pos,paus,time,oid);
  },100);
}

function syncPlayer(pos, paus, time, oid){
  updateOwnerState(oid);
  // применяем блокировку только к зрителям
  blocker.style.display = (!iAmOwner && controlsLocked) ? 'block' : 'none';
  player.controls      = iAmOwner || !controlsLocked;

  if(time<lastUpdate) return;
  lastUpdate = time;
  if(!player) return;
  isRemoteAction = true;

  if(Math.abs(player.currentTime-pos)>0.7 && player.readyState>0){
    player.currentTime = pos;
  }
  if(paus && !player.paused) player.pause();
  if(!paus && player.paused){
    player.play().catch(()=>{
      if(!window.__autoplayWarned){
        window.__autoplayWarned=true;
        alert('Нажмите по видео для автозапуска');
      }
    });
  }
  setTimeout(()=>isRemoteAction=false,120);
}

socket.on('sync_state', d=>{
  if(!player) initialSync=d;
  else debouncedSync(d.position,d.is_paused,d.updatedAt,d.owner_id);
});
socket.on('player_update', d=>{
  debouncedSync(d.position,d.is_paused,d.updatedAt,d.owner_id);
});

// --- Инициализация плеера и UI ---
async function fetchRoom(){
  try{
    const res = await fetch(`${BACKEND}/api/rooms/${roomId}`);
    if(!res.ok) throw new Error(res.status);
    const roomData = await res.json();
    updateOwnerState(roomData.owner_id);
    if(!roomData.owner_id&&myUserId){
      await setOwnerIdInDb(roomId,myUserId);
      ownerId=myUserId; iAmOwner=true;
    }
    const movie = movies.find(m=>m.id===roomData.movie_id);
    if(!movie?.videoUrl) throw new Error('Фильм не найден');
    backLink.href = `${movie.html}?id=${movie.id}`;

    // видео + блокер
    playerWrapper.innerHTML='';
    const wrap = document.createElement('div');
    wrap.style.position='relative';
    wrap.innerHTML = `<video id="videoPlayer" controls crossorigin="anonymous" playsinline
                           style="width:100%;border-radius:14px"></video>`;
    const spinner = createSpinner();
    wrap.appendChild(spinner);
    blocker = document.createElement('div');
    blocker.id='blocker';
    Object.assign(blocker.style,{
      position:'absolute',top:0,left:0,width:'100%',height:'100%',
      background:'rgba(0,0,0,0)',pointerEvents:'all',
      display:(!iAmOwner&&controlsLocked)?'block':'none'
    });
    wrap.appendChild(blocker);
    playerWrapper.appendChild(wrap);

    // badge
    const badge=document.createElement('div');
    badge.className='room-id-badge';
    badge.innerHTML=`
      <small>ID комнаты:</small>
      <code>${roomId}</code>
      <button id="copyRoomId">Копировать</button>
    `;
    playerWrapper.after(badge);
    document.getElementById('copyRoomId').onclick=()=>{
      navigator.clipboard.writeText(roomId);
      alert('Скопировано');
    };

    // чекбокс блокировки только для owner-а
    if(iAmOwner){
      const ctrlDiv=document.createElement('div');
      ctrlDiv.style.margin='8px 0';
      ctrlDiv.innerHTML=`
        <label>
          <input type="checkbox" id="toggleLock" ${controlsLocked?'checked':''}/>
          Запретить переключение зрителям
        </label>
      `;
      badge.after(ctrlDiv);
      document.getElementById('toggleLock').addEventListener('change',e=>{
        controlsLocked = e.target.checked;
        // шлём всем
        socket.emit('toggle_controls',{ roomId, locked: controlsLocked });
        // применяем только для зрителей
        blocker.style.display = controlsLocked ? 'block' : 'none';
        player.controls      = true; // owner всегда с controls
      });
    }

    const v = document.getElementById('videoPlayer');
    if(window.Hls?.isSupported()){
      const hls=new Hls();
      hls.loadSource(movie.videoUrl);
      hls.attachMedia(v);
      hls.on(Hls.Events.ERROR,(_,d)=>console.error(d));
      v.addEventListener('waiting',()=>spinner.style.display='block');
      v.addEventListener('playing',()=>spinner.style.display='none');
    } else if(v.canPlayType('application/vnd.apple.mpegurl')){
      v.src=movie.videoUrl;
    } else throw new Error('HLS не поддерживается');

    v.addEventListener('loadedmetadata',()=>{
      if(initialSync){
        syncPlayer(
          initialSync.position,
          initialSync.is_paused,
          initialSync.updatedAt,
          initialSync.owner_id
        );
        initialSync=null;
      }
    });

    // события play/pause/seek
    v.addEventListener('play',()=>{
      if(!iAmOwner && controlsLocked){
        v.pause();
        return;
      }
      if(iAmOwner && !isRemoteAction) emitPlayerAction(false);
    });
    v.addEventListener('pause',()=>{
      if(!iAmOwner && controlsLocked){
        v.play();
        return;
      }
      if(iAmOwner && !isRemoteAction) emitPlayerAction(true);
    });
    v.addEventListener('seeking',()=>{ isSeeking=true; });
    v.addEventListener('seeked',()=>{
      if(iAmOwner && !isRemoteAction) emitPlayerAction(v.paused);
      setTimeout(()=>isSeeking=false,120);
    });

    player = v;

  } catch(err){
    console.error(err);
    playerWrapper.innerHTML=`<p class="error">Ошибка: ${err.message}</p>`;
  }
}

// сервер меняет флаг
socket.on('controls_locked', locked=>{
  controlsLocked = locked;
  blocker.style.display = (!iAmOwner && controlsLocked)?'block':'none';
  player.controls      = iAmOwner || !controlsLocked;
});

// при смене owner-а
socket.on('owner_changed',newId=>{
  updateOwnerState(newId);
});

function createSpinner(){
  const s=document.createElement('div');
  s.className='buffer-spinner';
  s.innerHTML=`<div class="double-bounce1"></div><div class="double-bounce2"></div>`;
  s.style.display='none';
  return s;
}
function appendMessage(a,t){
  const d=document.createElement('div');
  d.className='chat-message';
  d.innerHTML=`<strong>${a}:</strong> ${t}`;
  messagesBox.appendChild(d);
  messagesBox.scrollTop = messagesBox.scrollHeight;
}
function appendSystemMessage(t){
  const d=document.createElement('div');
  d.className='chat-message system-message';
  d.innerHTML=`<em>${t}</em>`;
  messagesBox.appendChild(d);
  messagesBox.scrollTop = messagesBox.scrollHeight;
}
