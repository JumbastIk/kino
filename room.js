// Добавил улучшения: защиту от резких изменений и дополнительную проверку перед синхронизацией.
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
let spinner;
let isRemoteAction = false;
let lastUpdate     = 0;
let lastPing       = 0;
let myUserId       = null;
let initialSync    = null;
let syncTimeout    = null;
let metadataReady  = false;
let sendLock       = false;

// thresholds
const HARD_SYNC_THRESHOLD   = 0.3;
const SOFT_SYNC_THRESHOLD   = 0.05;
const AUTO_RESYNC_THRESHOLD = 1.0;

// 1) measure RTT
function measurePing() {
  const t0 = Date.now();
  socket.emit('ping');
  socket.once('pong', () => {
    lastPing = Date.now() - t0;
    console.log('[PING]', lastPing, 'ms');
  });
}
setInterval(measurePing, 10000);

// 2) on connect
socket.on('connect', () => {
  myUserId = socket.id;
  socket.emit('join', { roomId, userData: { id: myUserId, first_name: 'Гость' } });
  socket.emit('request_state', { roomId });
  fetchRoom();
});
socket.on('reconnect', () => {
  socket.emit('request_state', { roomId });
});

// 3) chat & members (без изменений)
// ...
// твой существующий код для чата и участников остался без изменений.

// 4) incoming sync с дополнительной защитой от частых вызовов
socket.on('sync_state', d => scheduleSync(d));
socket.on('player_update', d => scheduleSync(d));

function scheduleSync(d) {
  initialSync = d;
  if (metadataReady) {
    clearTimeout(syncTimeout);
    syncTimeout = setTimeout(() => doSync(d), 100); // небольшая задержка для стабильности
    initialSync = null;
  }
}

// 5) улучшенный doSync с проверкой на адекватность drift
function doSync({ position: pos, is_paused: isPaused, updatedAt: serverTs }) {
  console.log('[doSync START]', {
    now: Date.now(), serverTs, pos, isPaused,
    lastUpdate, currentTime: player?.currentTime
  });

  if (serverTs <= lastUpdate) {
    console.log('[doSync] skipped due to timestamp', { serverTs, lastUpdate });
    return;
  }
  lastUpdate = serverTs;
  if (!player || !metadataReady) return;

  isRemoteAction = true;

  const now = Date.now();
  const rttSec = lastPing / 1000;
  const oneWayDelay = rttSec / 2;
  const elapsed = (now - serverTs) / 1000;
  const drift = elapsed - oneWayDelay;

  const target = isPaused ? pos : pos + drift;
  const delta = target - player.currentTime;
  const absD = Math.abs(delta);

  console.log('[doSync]', { drift, target, delta, absD });

  if (absD > AUTO_RESYNC_THRESHOLD) {
    console.log('[doSync] AUTO_RESYNC_THRESHOLD exceeded → request_state');
    socket.emit('request_state', { roomId });
  }
  else if (absD > HARD_SYNC_THRESHOLD) {
    console.log('[doSync] HARD_SYNC_THRESHOLD → jump to', target);
    player.currentTime = target;
  }
  else if (!isPaused && absD > SOFT_SYNC_THRESHOLD) {
    const rate = 1 + delta * 0.5;
    console.log('[doSync] SOFT_SYNC_THRESHOLD → adjust rate to', rate);
    player.playbackRate = rate;
  }
  else if (player.playbackRate !== 1) {
    player.playbackRate = 1;
  }

  if (isPaused && !player.paused) {
    console.log('[doSync] pausing');
    player.pause();
  } else if (!isPaused && player.paused) {
    console.log('[doSync] playing');
    player.play().catch(() => {});
  }

  console.log('[doSync END]', {
    currentTime: player.currentTime,
    paused: player.paused,
    playbackRate: player.playbackRate
  });

  setTimeout(() => {
    isRemoteAction = false;
    player.playbackRate = 1;
  }, 50);
}

// 6) fetchRoom & init player (добавил event listener на ошибки HLS)
async function fetchRoom() {
  try {
    const res = await fetch(`${BACKEND}/api/rooms/${roomId}`);
    if (!res.ok) throw new Error(res.status);
    const { movie_id } = await res.json();
    const movie = movies.find(m => m.id === movie_id);
    if (!movie?.videoUrl) throw new Error('Фильм не найден');

    backLink.href = `${movie.html}?id=${movie.id}`;
    playerWrapper.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.style.position = 'relative';
    wrap.innerHTML = `<video id="videoPlayer" controls muted playsinline crossorigin="anonymous"
      style="width:100%;border-radius:14px;"></video>`;
    spinner = createSpinner();
    wrap.appendChild(spinner);
    playerWrapper.appendChild(wrap);

    const badge = document.createElement('div');
    badge.className = 'room-id-badge';
    badge.innerHTML = `
      <small>ID комнаты:</small><code>${roomId}</code>
      <button id="copyRoomId">Копировать</button>
    `;
    playerWrapper.after(badge);
    document.getElementById('copyRoomId').onclick = () => {
      navigator.clipboard.writeText(roomId);
      alert('Скопировано');
    };

    const v = document.getElementById('videoPlayer');
    if (window.Hls?.isSupported()) {
      const hls = new Hls();
      hls.loadSource(movie.videoUrl);
      hls.attachMedia(v);
      hls.on(Hls.Events.ERROR, (e, data) => {
        console.error('HLS ERROR', data);
        spinner.style.display = 'none';
      });
      v.addEventListener('waiting', () => spinner.style.display = 'block');
      v.addEventListener('playing', () => spinner.style.display = 'none');
    } else if (v.canPlayType('application/vnd.apple.mpegurl')) {
      v.src = movie.videoUrl;
    } else throw new Error('HLS не поддерживается');

    v.addEventListener('loadedmetadata', () => {
      metadataReady = true;
      if (initialSync) doSync(initialSync);
    });

    v.addEventListener('seeked', () => !isRemoteAction && emitAction(v.paused));
    v.addEventListener('play', () => !isRemoteAction && emitAction(false));
    v.addEventListener('pause', () => !isRemoteAction && emitAction(true));

    player = v;

  } catch (err) {
    console.error(err);
    playerWrapper.innerHTML = `<p class="error">Ошибка: ${err.message}</p>`;
  }
}

// Остальные твои helper-функции без изменений.
