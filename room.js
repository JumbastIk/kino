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

// DOM
const playerWrapper = document.getElementById('playerWrapper');
const backLink      = document.getElementById('backLink');
const messagesBox   = document.getElementById('messages');
const membersList   = document.getElementById('membersList');
const msgInput      = document.getElementById('msgInput');
const sendBtn       = document.getElementById('sendBtn');

// Видео-плеер
let player;
let spinner;
let metadataReady   = false;
let isRemoteAction  = false;
let sendLock        = false;

// Синхронизация
let lastPingMs  = 0;     // RTT в мс
let lastSyncTs  = 0;     // timestamp последнего sync_state
const SYNC_INTERVAL_MS      = 500;
const HARD_THRESHOLD_SEC    = 0.3;
const SOFT_THRESHOLD_SEC    = 0.1;
const AUTO_THRESHOLD_SEC    = 1.0;

// === 1) Измеряем RTT ===
function measurePing() {
  const t0 = Date.now();
  socket.emit('ping');
  socket.once('pong', () => {
    lastPingMs = Date.now() - t0;
    console.log('[PING]', lastPingMs, 'ms');
  });
}
setInterval(measurePing, 10000);

// === 2) Подключаемся и вступаем в комнату ===
socket.on('connect', () => {
  console.log('[socket] connected', socket.id);
  socket.emit('join', { roomId });
  fetchRoom();  
});
socket.on('reconnect', () => {
  console.log('[socket] reconnect');
  socket.emit('join', { roomId });
});

// === 3) Чат и участники ===
socket.on('members', ms => {
  membersList.innerHTML =
    `<div class="chat-members-label">Участники (${ms.length}):</div>` +
    `<ul>${ms.map(m=>`<li>${m.user_id}</li>`).join('')}</ul>`;
});
socket.on('history', data => {
  messagesBox.innerHTML = '';
  data.forEach(m => appendMessage(m.author, m.text));
});
socket.on('chat_message', m => appendMessage(m.author, m.text));
sendBtn.addEventListener('click', sendMessage);
msgInput.addEventListener('keydown', e => { if (e.key==='Enter') sendMessage(); });
function sendMessage() {
  const text = msgInput.value.trim();
  if (!text) return;
  socket.emit('chat_message', { roomId, author:'Гость', text });
  msgInput.value = '';
}

// === 4) Получаем синхронизацию от сервера по таймеру ===
socket.on('sync_state', doSync);

// === 5) Логика doSync ===
function doSync({ pos, paused, serverTs }) {
  console.log('[doSync START]', {
    now: Date.now(), serverTs, pos, paused,
    lastSyncTs, current: player?.currentTime
  });

  // защититься от старых сообщений
  if (serverTs <= lastSyncTs) {
    console.log('[doSync] SKIP stale sync', { serverTs, lastSyncTs });
    return;
  }
  lastSyncTs = serverTs;
  if (!player || !metadataReady) {
    console.log('[doSync] player not ready — сохраняем initial');
    return;
  }

  isRemoteAction = true;

  // расчёты
  const now = Date.now();
  const rttSec  = lastPingMs / 1000;
  const oneWay = rttSec / 2;
  const elapsed = (now - serverTs) / 1000;
  const drift = elapsed - oneWay;
  const target = paused ? pos : pos + Math.max(0, drift);
  const delta  = target - player.currentTime;
  const absD   = Math.abs(delta);

  console.log('[doSync] drift, target, delta, absD', {
    drift, target, delta, absD
  });

  if (absD > AUTO_THRESHOLD_SEC) {
    console.warn('[doSync] AUTO resync → server request');
    socket.emit('request_state', { roomId });
  }
  else if (absD > HARD_THRESHOLD_SEC) {
    console.log('[doSync] HARD jump to', target);
    player.currentTime = target;
  }
  else if (!paused && absD > SOFT_THRESHOLD_SEC) {
    const rate = 1 + delta * 0.5;
    console.log('[doSync] SOFT adjust rate →', rate);
    player.playbackRate = rate;
  }
  else if (player.playbackRate !== 1) {
    console.log('[doSync] rate reset to 1');
    player.playbackRate = 1;
  }

  // пауза / воспроизведение
  if (paused && !player.paused) {
    console.log('[doSync] pause');
    player.pause();
  }
  if (!paused && player.paused) {
    console.log('[doSync] play');
    player.play().catch(()=>{});
  }

  console.log('[doSync END]', {
    currentTime: player.currentTime,
    paused: player.paused,
    playbackRate: player.playbackRate
  });

  // сброс флага
  setTimeout(() => {
    isRemoteAction = false;
    if (player.playbackRate !== 1) player.playbackRate = 1;
  }, 50);
}

// === 6) Инициализация плеера и fetchRoom ===
async function fetchRoom(){
  try {
    const res = await fetch(`${BACKEND}/api/rooms/${roomId}`);
    if (!res.ok) throw new Error(res.status);
    const { movie_id } = await res.json();
    const movie = movies.find(m=>m.id===movie_id);
    if (!movie) throw new Error('Фильм не найден');

    backLink.href = `${movie.html}?id=${movie.id}`;
    playerWrapper.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.style.position = 'relative';
    wrap.innerHTML = `
      <video id="videoPlayer" controls muted playsinline crossorigin="anonymous"
             style="width:100%;border-radius:14px;"></video>
    `;
    spinner = createSpinner();
    wrap.appendChild(spinner);
    playerWrapper.appendChild(wrap);

    // HLS
    const v = document.getElementById('videoPlayer');
    if (window.Hls?.isSupported()) {
      const hls = new Hls();
      hls.loadSource(movie.videoUrl);
      hls.attachMedia(v);
      v.addEventListener('waiting',  ()=>spinner.style.display='block');
      v.addEventListener('playing', ()=>spinner.style.display='none');
    } else if (v.canPlayType('application/vnd.apple.mpegurl')) {
      v.src = movie.videoUrl;
    } else {
      throw new Error('HLS не поддерживается');
    }

    // как только метаданные готовы — включаем синхронизацию
    v.addEventListener('loadedmetadata', () => {
      metadataReady = true;
      console.log('[player] metadataReady');
    });

    // отправка действий пользователя
    ['seeked','play','pause'].forEach(evt => {
      v.addEventListener(evt, () => {
        if (isRemoteAction || sendLock) return;
        const paused = v.paused;
        const pos    = v.currentTime;
        console.log('[EMIT] player_action', { pos, paused });
        socket.emit('player_action', { roomId, pos, paused });
        sendLock = true;
        setTimeout(()=> sendLock = false, 200);
      });
    });

    player = v;
  }
  catch(err) {
    console.error(err);
    playerWrapper.innerHTML = `<p class="error">Ошибка: ${err.message}</p>`;
  }
}

// === 7) Утилиты ===
function createSpinner(){
  const s = document.createElement('div');
  s.className = 'buffer-spinner';
  s.innerHTML = `<div class="double-bounce1"></div><div class="double-bounce2"></div>`;
  s.style.display = 'none';
  return s;
}
function appendMessage(author, text){
  const d = document.createElement('div');
  d.className = 'chat-message';
  d.innerHTML = `<strong>${author}:</strong> ${text}`;
  messagesBox.appendChild(d);
  messagesBox.scrollTop = messagesBox.scrollHeight;
}
