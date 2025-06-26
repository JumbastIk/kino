// room.js

const BACKEND = location.hostname.includes('localhost')
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
let lastUpdate     = 0;
let myUserId       = null;
let initialSync    = null;
let syncTimeout    = null;

let lastPing       = 0;
let sendLock       = false;

// Флаг: после локальной seek-операции игнорируем 1-е входящее sync
let localSeeking = false;
// Нужен, чтобы запомнить, было ли до промотки видео в режиме PLAY
let wasPlayingBeforeSeek = false;

//
// 1) Меряем RTT
//
function measurePing() {
  const t0 = Date.now();
  socket.emit('ping');
  socket.once('pong', () => {
    lastPing = Date.now() - t0;
  });
}
setInterval(measurePing, 10_000);

//
// 2) Троттлим отправку действий
//
function emitPlayerActionThrottled(isPaused) {
  if (sendLock) return;
  socket.emit('player_action', {
    roomId,
    position:  player.currentTime,
    is_paused: isPaused,
    speed:     player.playbackRate
  });
  sendLock = true;
  setTimeout(() => sendLock = false, 150);
}

//
// 3) Подключаемся и синхронизируем
//
socket.on('connect', () => {
  myUserId = socket.id;
  socket.emit('join', { roomId, userData: { id: myUserId, first_name: 'Гость' } });
  socket.emit('request_state', { roomId });
  fetchRoom();
});

//
// Chat & members
//
socket.on('members', ms => {
  membersList.innerHTML =
    `<div class="chat-members-label">Участники (${ms.length}):</div>
     <ul>${ms.map(m=>`<li>${m.user_id}</li>`).join('')}</ul>`;
});
socket.on('history', data => {
  messagesBox.innerHTML = '';
  data.forEach(m=>appendMessage(m.author, m.text));
});
socket.on('chat_message', m => appendMessage(m.author, m.text));
socket.on('system_message', msg => msg?.text && appendSystemMessage(msg.text));

//
// send chat
//
sendBtn.addEventListener('click', sendMessage);
msgInput.addEventListener('keydown', e => e.key==='Enter' && sendMessage());
function sendMessage() {
  const t = msgInput.value.trim();
  if (!t) return;
  socket.emit('chat_message', { roomId, author:'Гость', text:t });
  msgInput.value = '';
}

//
// 4) Sync с учётом пинга и прогнозом
//
function debouncedSync(pos, isPaused, serverTs) {
  if (syncTimeout) clearTimeout(syncTimeout);
  syncTimeout = setTimeout(()=>{
    doSync(pos, isPaused, serverTs);
  }, 50);
}

function doSync(pos, isPaused, serverTs) {
  if (serverTs < lastUpdate) return;
  lastUpdate = serverTs;
  if (!player) return;
  isRemoteAction = true;

  const now      = Date.now();
  const driftMs  = (now - serverTs) - lastPing/2;
  const target   = isPaused ? pos : pos + driftMs/1000;
  const delta    = target - player.currentTime;
  const absDelta = Math.abs(delta);

  if (absDelta > 1) {
    player.currentTime = target;
  } else if (absDelta > 0.05) {
    player.playbackRate = delta > 0 ? 1.05 : 0.95;
    setTimeout(() => {
      if (player) player.playbackRate = 1;
    }, 500);
  }

  if (isPaused && !player.paused) {
    player.pause();
  } else if (!isPaused && player.paused) {
    player.play().catch(()=>{
      // ошибок нет
    });
  }

  setTimeout(() => isRemoteAction = false, 100);
}

socket.on('sync_state', d => {
  if (!player) {
    initialSync = d;
  } else if (localSeeking) {
    localSeeking = false;
  } else {
    debouncedSync(d.position, d.is_paused, d.updatedAt);
  }
});
socket.on('player_update', d => {
  if (localSeeking) {
    localSeeking = false;
  } else {
    debouncedSync(d.position, d.is_paused, d.updatedAt);
  }
});

//
// Инициализация плеера и фикса seek-logic
//
async function fetchRoom(){
  try {
    const res = await fetch(`${BACKEND}/api/rooms/${roomId}`);
    if (!res.ok) throw new Error(res.status);
    const roomData = await res.json();

    const movie = movies.find(m=>m.id===roomData.movie_id);
    if (!movie?.videoUrl) throw new Error('Фильм не найден');
    backLink.href = `${movie.html}?id=${movie.id}`;

    playerWrapper.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.style.position='relative';
    wrap.innerHTML=`
      <video id="videoPlayer" controls autoplay muted crossorigin="anonymous" playsinline
             style="width:100%;border-radius:14px"></video>`;
    const spinner = createSpinner();
    wrap.appendChild(spinner);
    playerWrapper.appendChild(wrap);

    const badge = document.createElement('div');
    badge.className='room-id-badge';
    badge.innerHTML=`
      <small>ID комнаты:</small><code>${roomId}</code>
      <button id="copyRoomId">Копировать</button>`;
    playerWrapper.after(badge);
    document.getElementById('copyRoomId').onclick=()=>{
      navigator.clipboard.writeText(roomId);
      alert('Скопировано');
    };

    const v = document.getElementById('videoPlayer');
    v.muted = true;
    if (window.Hls?.isSupported()) {
      const hls = new Hls();
      hls.loadSource(movie.videoUrl);
      hls.attachMedia(v);
      v.addEventListener('waiting', ()=>spinner.style.display='block');
      v.addEventListener('playing',()=>spinner.style.display='none');
    } else if (v.canPlayType('application/vnd.apple.mpegurl')) {
      v.src = movie.videoUrl;
    } else throw new Error('HLS не поддерживается');

    v.addEventListener('loadedmetadata', () => {
      if (initialSync) {
        doSync(
          initialSync.position,
          initialSync.is_paused,
          initialSync.updatedAt
        );
        initialSync = null;
      }
    });

    // При старте локальной seek-операции помечаем, что следующий sync — наш own-echo
    v.addEventListener('seeking', () => {
      if (!isRemoteAction) {
        localSeeking = true;
        wasPlayingBeforeSeek = !v.paused;
        if (syncTimeout) {
          clearTimeout(syncTimeout);
          syncTimeout = null;
        }
      }
    });

    // После завершения seek — ставим в тот же режим, в котором было видео до промотки
    v.addEventListener('seeked', () => {
      if (!isRemoteAction) {
        if (wasPlayingBeforeSeek) {
          v.play().catch(()=>{});
          emitPlayerActionThrottled(false);
        } else {
          v.pause();
          emitPlayerActionThrottled(true);
        }
      }
    });

    v.addEventListener('play',  () => { if (!isRemoteAction) emitPlayerActionThrottled(false); });
    v.addEventListener('pause', () => { if (!isRemoteAction) emitPlayerActionThrottled(true); });

    player = v;

  } catch(err){
    console.error(err);
    playerWrapper.innerHTML=`<p class="error">Ошибка: ${err.message}</p>`;
  }
}

function createSpinner(){
  const s = document.createElement('div');
  s.className = 'buffer-spinner';
  s.innerHTML = `<div class="double-bounce1"></div><div class="double-bounce2"></div>`;
  s.style.display = 'none';
  return s;
}

function appendMessage(a,t){
  const d = document.createElement('div');
  d.className = 'chat-message';
  d.innerHTML = `<strong>${a}:</strong> ${t}`;
  messagesBox.appendChild(d);
  messagesBox.scrollTop = messagesBox.scrollHeight;
}
function appendSystemMessage(t){
  const d = document.createElement('div');
  d.className = 'chat-message system-message';
  d.innerHTML = `<em>${t}</em>`;
  messagesBox.appendChild(d);
  messagesBox.scrollTop = messagesBox.scrollHeight;
}
