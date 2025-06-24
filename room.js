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

let player;
let isRemoteAction = false;
let lastUpdate = 0;
let ownerId = null;
let iAmOwner = false;
let myUserId = null;
let initialSync = null;
let syncTimeout = null;
let controlsLocked = false;  // флаг блокировки управления

// Показываем или скрываем только play/progress, оставляя volume/quality/fullscreen
function applyControlsLockUI() {
  const playBtn = document.getElementById('btn-play');
  const progress = document.getElementById('progress-container');
  if (!playBtn || !progress) return;
  if (!iAmOwner && controlsLocked) {
    playBtn.style.display = 'none';
    progress.style.display = 'none';
  } else {
    playBtn.style.display = '';
    progress.style.display = '';
  }
}

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
  applyControlsLockUI();

  if(time<lastUpdate) return;
  lastUpdate = time;
  if(!player) return;
  isRemoteAction = true;

  if(Math.abs(player.currentTime-pos)>0.7 && player.readyState>0){
    player.currentTime = pos;
  }
  if(paus && !player.paused) player.pause();
  if(!paus && player.paused){
    player.play().catch(()=>{});
  }
  setTimeout(()=>isRemoteAction=false,120);
}

socket.on('sync_state', d=>{
  if(!player) initialSync = d;
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

    controlsLocked = !!roomData.controls_locked;
    updateOwnerState(roomData.owner_id);
    if(!roomData.owner_id && myUserId){
      await setOwnerIdInDb(roomId,myUserId);
      ownerId = myUserId;
      iAmOwner = true;
    }

    const movie = movies.find(m=>m.id===roomData.movie_id);
    if(!movie?.videoUrl) throw new Error('Фильм не найден');
    backLink.href = `${movie.html}?id=${movie.id}`;

    // видео
    playerWrapper.innerHTML = `
      <div class="video-container">
        <video id="videoPlayer" playsinline crossorigin="anonymous"></video>
        <div id="initial-overlay" class="overlay">
          <button id="btn-initial-play">▶ Запустить видео</button>
        </div>
        <div id="custom-controls" class="controls">
          <button id="btn-play">▶️</button>
          <div id="progress-container"><div id="progress-bar"></div></div>
          <button id="btn-vol">🔊</button>
          <select id="select-quality"></select>
          <button id="btn-fullscreen">⛶</button>
        </div>
      </div>
    `;

    player = document.getElementById('videoPlayer');
    const overlay = document.getElementById('initial-overlay');
    const btnInit = document.getElementById('btn-initial-play');
    const btnPlay = document.getElementById('btn-play');
    const progCont = document.getElementById('progress-container');
    const progBar = document.getElementById('progress-bar');
    const btnVol = document.getElementById('btn-vol');
    const selectQ = document.getElementById('select-quality');
    const btnFS = document.getElementById('btn-fullscreen');

    // HLS
    if(window.Hls?.isSupported()){
      const hls=new Hls();
      hls.loadSource(movie.videoUrl);
      hls.attachMedia(player);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        selectQ.innerHTML = hls.levels
          .map((l,i)=>`<option value="${i}">${l.height}p</option>`)
          .join('');
      });
    } else if(player.canPlayType('application/vnd.apple.mpegurl')){
      player.src = movie.videoUrl;
    } else throw new Error('HLS не поддерживается');

    // первый клик
    btnInit.addEventListener('click', ()=>{
      player.play().catch(()=>{});
      overlay.style.display = 'none';
      applyControlsLockUI();
    });

    // play/pause
    btnPlay.addEventListener('click', ()=>{
      if (player.paused) player.play(); else player.pause();
    });
    player.addEventListener('play', ()=> {
      if (iAmOwner) emitPlayerAction(false);
    });
    player.addEventListener('pause', ()=> {
      if (iAmOwner) emitPlayerAction(true);
    });

    // прогресс
    player.addEventListener('timeupdate', ()=>{
      const pct = player.currentTime / player.duration * 100;
      progBar.style.width = pct + '%';
    });
    progCont.addEventListener('click', e=>{
      if (!iAmOwner && controlsLocked) return;
      const rect = progCont.getBoundingClientRect();
      const pct = (e.clientX - rect.left) / rect.width;
      player.currentTime = pct * player.duration;
    });

    // громкость
    btnVol.addEventListener('click', ()=>{
      player.muted = !player.muted;
    });

    // качество
    selectQ.addEventListener('change', e=>{
      if (window.Hls && hls) hls.currentLevel = Number(e.target.value);
    });

    // fullscreen
    btnFS.addEventListener('click', ()=>{
      document.querySelector('.video-container').requestFullscreen();
    });

    // начальная синхронизация
    player.addEventListener('loadedmetadata', ()=>{
      applyControlsLockUI();
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

  } catch(err){
    console.error(err);
    playerWrapper.innerHTML=`<p class="error">Ошибка: ${err.message}</p>`;
  }
}

// сервер меняет флаг
socket.on('controls_locked', locked=>{
  controlsLocked = locked;
  applyControlsLockUI();
});

// owner сменился
socket.on('owner_changed', newId=>{
  updateOwnerState(newId);
  applyControlsLockUI();
});

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
