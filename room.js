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
let isRemoteAction   = false;
let lastUpdate       = 0;
let myUserId         = null;
let initialSync      = null;
let syncTimeout      = null;

let lastPing         = 0;
let sendLock         = false;
let lastLocalAction  = 0;

// измеряем RTT
function measurePing() {
  const t0 = Date.now();
  socket.emit('ping');
  socket.once('pong', () => {
    lastPing = Date.now() - t0;
  });
}
setInterval(measurePing, 10000);

// throttle и пометка локального действия
function emitAction(isPaused) {
  if (sendLock || !player) return;
  lastLocalAction = Date.now();
  socket.emit('player_action', {
    roomId,
    position:  player.currentTime,
    is_paused: isPaused,
    speed:     player.playbackRate
  });
  sendLock = true;
  setTimeout(() => sendLock = false, 150);
}

// socket events
socket.on('connect', () => {
  myUserId = socket.id;
  socket.emit('join', { roomId, userData: { id: myUserId, first_name: 'Гость' } });
  socket.emit('request_state', { roomId });
  fetchRoom();
});

socket.on('members', ms => {
  membersList.innerHTML =
    `<div class="chat-members-label">Участники (${ms.length}):</div>
     <ul>${ms.map(m=>`<li>${m.user_id}</li>`).join('')}</ul>`;
});
socket.on('history', data => {
  messagesBox.innerHTML = '';
  data.forEach(m => appendMessage(m.author, m.text));
});
socket.on('chat_message', m => appendMessage(m.author, m.text));
socket.on('system_message', msg => msg?.text && appendSystemMessage(msg.text));
socket.on('pong', () => {});
socket.on('error', () => {
  // при ошибке попробуем пересинхронизироваться
  setTimeout(() => socket.emit('request_state', { roomId }), 1000);
});

// синхронизация
function debouncedSync(pos, isPaused, serverTs) {
  clearTimeout(syncTimeout);
  syncTimeout = setTimeout(() => {
    doSync(pos, isPaused, serverTs);
  }, 50);
}

function doSync(pos, isPaused, serverTs) {
  // игнорируем эхо сразу после локального seek/play/pause
  if (serverTs <= lastLocalAction + 500) return;
  // игнорируем старые
  if (serverTs < lastUpdate) return;
  lastUpdate = serverTs;
  if (!player) return;
  isRemoteAction = true;

  // прогноз позиции
  const now   = Date.now();
  const drift= (now - serverTs) - lastPing/2;
  const target = isPaused
    ? pos
    : pos + drift/1000;

  const delta = target - player.currentTime;
  const abs   = Math.abs(delta);

  if (abs > 1) {
    player.currentTime = target;
  } else if (abs > 0.05) {
    player.playbackRate = delta > 0 ? 1.05 : 0.95;
    setTimeout(() => { if (player) player.playbackRate = 1; }, 500);
  }

  // если сервер говорит pause, но это эхо после локального seek/play — пропускаем
  if (isPaused) {
    // только если прошло >500 мс после нашего действия
    if (Date.now() > lastLocalAction + 500 && !player.paused) {
      player.pause();
    }
  } else {
    if (player.paused) {
      player.play().catch(() => {
        if (!window.__autoplayWarned) {
          window.__autoplayWarned = true;
          alert('Нажмите по видео для автозапуска');
        }
      });
    }
  }

  setTimeout(() => isRemoteAction = false, 100);
}

socket.on('sync_state', d => {
  if (!player) initialSync = d;
  else           debouncedSync(d.position, d.is_paused, d.updatedAt);
});
socket.on('player_update', d => {
  debouncedSync(d.position, d.is_paused, d.updatedAt);
});

// чат
sendBtn.addEventListener('click', sendMessage);
msgInput.addEventListener('keydown', e => e.key==='Enter' && sendMessage());
function sendMessage() {
  const t = msgInput.value.trim();
  if (!t) return;
  socket.emit('chat_message', { roomId, author:'Гость', text:t });
  msgInput.value = '';
}

// инициализация плеера
async function fetchRoom() {
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
      <video id="videoPlayer" controls crossorigin="anonymous" playsinline
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
    if (window.Hls?.isSupported()) {
      const hls = new Hls();
      hls.loadSource(movie.videoUrl);
      hls.attachMedia(v);
      v.addEventListener('waiting', ()=>spinner.style.display='block');
      v.addEventListener('playing',()=>spinner.style.display='none');
    } else if (v.canPlayType('application/vnd.apple.mpegurl')) {
      v.src=movie.videoUrl;
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

    v.addEventListener('play',   () => { if (!isRemoteAction) emitAction(false); });
    v.addEventListener('pause',  () => { if (!isRemoteAction) emitAction(true); });
    v.addEventListener('seeked', () => { if (!isRemoteAction) emitAction(v.paused); });

    player = v;
  } catch (err) {
    console.error('FetchRoom error', err);
    playerWrapper.innerHTML = `<p class="error">Ошибка: ${err.message}</p>`;
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
