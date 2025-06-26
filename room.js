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

const playerWrapper   = document.getElementById('playerWrapper');
const backLink        = document.getElementById('backLink');
const messagesBox     = document.getElementById('messages');
const membersList     = document.getElementById('membersList');
const msgInput        = document.getElementById('msgInput');
const sendBtn         = document.getElementById('sendBtn');

let player;
let isRemoteAction     = false;
let lastUpdate         = 0;
let myUserId           = null;
let initialSync        = null;
let syncTimeout        = null;
let lastPing           = 0;
let sendLock           = false;
let localSeeking       = false;
let wasPlayingBeforeSeek = false;
let outOfSyncOverlay   = null;

// Порог для мгновенной коррекции (сек)
const HARD_SYNC_THRESHOLD = 0.3;
// Порог для плавной коррекции через скорость (сек)
const SOFT_SYNC_THRESHOLD = 0.05;

// ==========================
// Heartbeat: не нужен больше — все события вешаются на реальные user-интеракции
// ==========================
/*
setInterval(() => {
  if (player) {
    socket.emit('player_action', { ... });
  }
}, 2000);
*/

// ==========================
// 1) Измеряем RTT каждые 10 секунд
// ==========================
function measurePing() {
  const t0 = Date.now();
  socket.emit('ping');
  socket.once('pong', () => {
    lastPing = Date.now() - t0;
  });
}
setInterval(measurePing, 10_000);

// ==========================
// 2) Троттлим отправку действий игрока (play, pause, seek, ratechange)
// ==========================
function emitPlayerAction() {
  if (sendLock) return;
  socket.emit('player_action', {
    roomId,
    position:  player.currentTime,
    is_paused: player.paused,
    speed:     player.playbackRate
  });
  sendLock = true;
  setTimeout(() => sendLock = false, 150);
}

// ==========================
// 3) При подключении запрашиваем состояние и комнату
// ==========================
socket.on('connect', () => {
  myUserId = socket.id;
  socket.emit('join', { roomId, userData: { id: myUserId, first_name: 'Гость' } });
  socket.emit('request_state', { roomId });
  fetchRoom();
});

// ==========================
// 4) Чат и список участников — без изменений
// ==========================
socket.on('members', ms => { /* ... */ });
socket.on('history', data => { /* ... */ });
socket.on('chat_message', m => appendMessage(m.author, m.text));
socket.on('system_message', msg => msg?.text && appendSystemMessage(msg.text));
sendBtn.addEventListener('click', sendMessage);
msgInput.addEventListener('keydown', e => e.key==='Enter' && sendMessage());

// ==========================
// 5) Синхронизация с учётом пинга и drift-коррекции
// ==========================
function debouncedSync(pos, isPaused, serverTs) {
  if (syncTimeout) clearTimeout(syncTimeout);
  syncTimeout = setTimeout(() => {
    doSync(pos, isPaused, serverTs);
  }, 50);
}

function doSync(pos, isPaused, serverTs) {
  if (serverTs < lastUpdate) return;
  lastUpdate = serverTs;
  if (!player) return;
  isRemoteAction = true;

  const now     = Date.now();
  const driftMs = (now - serverTs) - lastPing/2;
  const target  = isPaused ? pos : pos + driftMs/1000;
  const delta   = target - player.currentTime;
  const absD    = Math.abs(delta);

  // 1) Жёсткая коррекция позиции
  if (absD > HARD_SYNC_THRESHOLD) {
    player.currentTime = target;
  }
  // 2) Плавная коррекция через скорость
  else if (absD > SOFT_SYNC_THRESHOLD && !isPaused) {
    // Ускоряем или замедляем на величину, пропорциональную drift
    const adjust = 1 + delta * 0.5; // можно тонко настроить коэфф.
    player.playbackRate = Math.min(1.5, Math.max(0.5, adjust));
  } else {
    // сброс скорости к норме, если нет дрейфа
    if (player.playbackRate !== 1) player.playbackRate = 1;
  }

  // 3) Синхронизируем play/pause
  if (isPaused && !player.paused) {
    player.pause();
  } else if (!isPaused && player.paused) {
    player.play().catch(()=>{});
  }

  // 4) Out-of-sync detection
  if (absD > 1) {
    showOutOfSync();  // подсветить рассинхрон и дать кнопку «Resync»
  } else {
    hideOutOfSync();
  }

  setTimeout(() => {
    isRemoteAction = false;
  }, 100);
}

// При получении стейта от сервера
socket.on('sync_state',  d => { initialSync = d; });
socket.on('player_update', d => {
  if (!localSeeking) debouncedSync(d.position, d.is_paused, d.updatedAt);
  else localSeeking = false;
});

// ==========================
// 6) Загрузка комнаты и инициализация плеера с собственным UI
// ==========================
async function fetchRoom(){
  try {
    const res = await fetch(`${BACKEND}/api/rooms/${roomId}`);
    if (!res.ok) throw new Error(res.status);
    const roomData = await res.json();

    const movie = movies.find(m => m.id === roomData.movie_id);
    if (!movie?.videoUrl) throw new Error('Фильм не найден');
    backLink.href = `${movie.html}?id=${movie.id}`;

    playerWrapper.innerHTML = '';
    // Контейнер для плеера + кастомной панели
    const wrap = document.createElement('div');
    wrap.style.position = 'relative';
    wrap.innerHTML = `
      <video id="videoPlayer" playsinline crossorigin="anonymous"
             style="width:100%;border-radius:14px; background:#000;"></video>
      <div id="controls" class="custom-controls">
        <button id="btnPlay">Play</button>
        <input id="seekBar" type="range" min="0" max="100" value="0">
        <button id="btnResync" style="display:none;">Resync</button>
      </div>
      <div id="outOfSync" class="out-of-sync" style="display:none;">
        Видео рас­синкро­ни­зировалось! <button id="doResync">Синхронизировать</button>
      </div>
    `;
    playerWrapper.appendChild(wrap);

    const v = document.getElementById('videoPlayer');

    // Загрузка HLS
    if (window.Hls?.isSupported()) {
      const hls = new Hls();
      hls.loadSource(movie.videoUrl);
      hls.attachMedia(v);
      v.addEventListener('waiting',  () => wrap.querySelector('.buffer-spinner').style.display = 'block');
      v.addEventListener('playing', () => wrap.querySelector('.buffer-spinner').style.display = 'none');
    } else if (v.canPlayType('application/vnd.apple.mpegurl')) {
      v.src = movie.videoUrl;
    } else {
      throw new Error('HLS не поддерживается');
    }

    // Когда метаданные загружены — делаем начальную синхронизацию
    v.addEventListener('loadedmetadata', () => {
      // настроим seekBar максимальное значение
      const sb = document.getElementById('seekBar');
      sb.max = v.duration;
      if (initialSync) {
        doSync(initialSync.position, initialSync.is_paused, initialSync.updatedAt);
        initialSync = null;
      }
    });

    // ========== Event-listeners для custom UI ==========
    document.getElementById('btnPlay').onclick = () => {
      if (v.paused) v.play();
      else           v.pause();
    };
    document.getElementById('seekBar').oninput = e => {
      localSeeking = true;
      v.currentTime = parseFloat(e.target.value);
    };
    document.getElementById('seekBar').onchange = () => {
      localSeeking = false;
      emitPlayerAction();
    };
    document.getElementById('doResync').onclick = () => {
      socket.emit('request_state', { roomId });
    };

    // Перехватываем события плеера
    v.addEventListener('seeking', () => {
      if (!isRemoteAction) {
        localSeeking = true;
        wasPlayingBeforeSeek = !v.paused;
      }
    });
    v.addEventListener('seeked', () => {
      if (!isRemoteAction) {
        if (wasPlayingBeforeSeek) v.play(); else v.pause();
        emitPlayerAction();
      }
    });
    v.addEventListener('play',      () => { if (!isRemoteAction) emitPlayerAction(); });
    v.addEventListener('pause',     () => { if (!isRemoteAction) emitPlayerAction(); });
    v.addEventListener('ratechange',() => { if (!isRemoteAction) emitPlayerAction(); });
    v.addEventListener('timeupdate',() => {
      // обновляем ползунок
      if (!isRemoteAction) {
        document.getElementById('seekBar').value = v.currentTime;
      }
    });

    player = v;

  } catch(err) {
    console.error(err);
    playerWrapper.innerHTML = `<p class="error">Ошибка: ${err.message}</p>`;
  }
}

// ==========================
// Out-of-sync UI
// ==========================
function showOutOfSync() {
  document.getElementById('outOfSync').style.display = 'block';
}
function hideOutOfSync() {
  document.getElementById('outOfSync').style.display = 'none';
}

// ========== вспомогательные функции чата ==========
function appendMessage(author, text){ /* ... */ }
function appendSystemMessage(text){ /* ... */ }
function sendMessage(){ /* ... */ }
function createSpinner(){ /* ... */ }
