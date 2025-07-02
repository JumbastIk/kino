const BACKEND = 'https://kino-fhwp.onrender.com';

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

// DOM elements
const playerWrapper     = document.getElementById('playerWrapper');
const video             = document.getElementById('videoPlayer');
const playPauseBtn      = document.getElementById('playPauseBtn');
const muteBtn           = document.getElementById('muteBtn');
const fullscreenBtn     = document.getElementById('fullscreenBtn');
// Ползунок прогресса
const progressSlider    = document.getElementById('progressSlider');
const progressContainer = document.getElementById('progressContainer');
const progressBar       = document.getElementById('progressBar');
const currentTimeLabel  = document.getElementById('currentTimeLabel');
const durationLabel     = document.getElementById('durationLabel');
const messagesBox       = document.getElementById('messages');
const membersList       = document.getElementById('membersList');
const msgInput          = document.getElementById('msgInput');
const sendBtn           = document.getElementById('sendBtn');
const backLink          = document.getElementById('backLink');
const roomIdCode        = document.getElementById('roomIdCode');
const copyRoomId        = document.getElementById('copyRoomId');

// Показ ID комнаты
if (roomIdCode) roomIdCode.textContent = roomId;
if (copyRoomId) copyRoomId.onclick = () => {
  navigator.clipboard.writeText(roomId);
  alert('Скопировано!');
};

let player            = video,
    spinner,
    myUserId          = null;
let metadataReady     = false;
let lastSyncLog       = 0;
let ignoreSyncEvent   = false, syncErrorTimeout = null;
let readyForControl   = false;
let isUserAction      = false; // только реальные клики отключают паузы

// Флаг для пропуска первой автопаузы при подключении
let skipFirstPause    = false;

// Для visibilitychange
let wasPausedOnHide   = true;

// Участники
let allMembers  = [];
let userTimeMap = {};
let userPingMap = {};

// Telegram WebApp
if (window.Telegram?.WebApp) {
  Telegram.WebApp.disableVerticalSwipes();
  Telegram.WebApp.enableClosingConfirmation();
}

// Inline-видео
video.setAttribute('playsinline', '');
video.setAttribute('webkit-playsinline', '');
video.autoplay = true;
video.muted    = true;

// Контролы
disableControls();
function enableControls() {
  [playPauseBtn, muteBtn, fullscreenBtn, progressContainer].forEach(el => {
    el.style.pointerEvents = '';
    el.style.opacity       = '';
  });
  progressSlider.disabled = false;
}
function disableControls() {
  [playPauseBtn, muteBtn, fullscreenBtn, progressContainer].forEach(el => {
    el.style.pointerEvents = 'none';
    el.style.opacity       = '.6';
  });
  progressSlider.disabled = true;
}

// --- Чат ---
function appendMessage(author, text) {
  const d = document.createElement('div');
  d.className = 'chat-message';
  d.innerHTML = `<strong>${author}:</strong> ${text}`;
  messagesBox.appendChild(d);
  messagesBox.scrollTop = messagesBox.scrollHeight;
}
function appendSystemMessage(text) {
  const d = document.createElement('div');
  d.className = 'chat-message system-message';
  d.innerHTML = `<em>${text}</em>`;
  messagesBox.appendChild(d);
  messagesBox.scrollTop = messagesBox.scrollHeight;
}
sendBtn.addEventListener('click', sendMessage);
msgInput.addEventListener('keydown', e => { if (e.key === 'Enter') sendMessage(); });
function sendMessage() {
  const t = msgInput.value.trim();
  if (!t) return;
  socket.emit('chat_message', { roomId, author: 'Гость', text: t });
  msgInput.value = '';
}

// Логгер
function logOnce(msg) {
  const now = Date.now();
  if (now - lastSyncLog > 600) {
    console.log(msg);
    lastSyncLog = now;
  }
}

// Пинг
function measurePingAndSend() {
  if (!player || !myUserId) return;
  const t0 = Date.now();
  socket.emit('ping');
  socket.once('pong', () => {
    const ping = Date.now() - t0;
    userPingMap[myUserId] = ping;
    userTimeMap[myUserId] = player.currentTime;
    socket.emit('update_time', {
      roomId,
      user_id: myUserId,
      currentTime: player.currentTime,
      ping
    });
  });
}
setInterval(measurePingAndSend, 1000);

socket.on('user_time_update', data => {
  if (data?.user_id) {
    userTimeMap[data.user_id] = data.currentTime;
    userPingMap[data.user_id] = data.ping;
    updateMembersList();
  }
});

// --- Сокет-события ---
socket.on('connect', () => {
  myUserId = socket.id;
  readyForControl = false;
  disableControls();

  // Пропустить первую автопаузу
  skipFirstPause = true;

  socket.emit('join', { roomId, userData: { id: myUserId, first_name: 'Гость' } });
  socket.emit('request_state', { roomId });
  fetchRoom();
});
socket.on('reconnect', () => {
  readyForControl = false;
  disableControls();
  socket.emit('request_state', { roomId });
});
socket.on('members', ms => {
  allMembers = ms;
  updateMembersList();
});
socket.on('history', data => {
  messagesBox.innerHTML = '';
  data.forEach(m => appendMessage(m.author, m.text));
});
socket.on('chat_message', m => appendMessage(m.author, m.text));
socket.on('system_message', msg => msg?.text && appendSystemMessage(msg.text));

// Обновить список участников
function updateMembersList() {
  if (!Array.isArray(allMembers)) return;
  membersList.innerHTML = allMembers.map(m => {
    const id   = m.user_id || m.id || '';
    const name = m.first_name || id;
    const t    = userTimeMap[id] ?? 0;
    const p    = userPingMap[id]  ?? '-';
    return `<li>
      <span class="member-name">${name}</span>
      <span class="member-time" style="margin-left:8px;font-family:monospace">${formatTime(t)}</span>
      <span class="member-ping" style="margin-left:7px;font-size:12px;color:#a970ff;">${p}ms</span>
    </li>`;
  }).join('');
}

// --- Синхронизация helper'ы ---
function jumpTo(target) {
  ignoreSyncEvent = true;
  player.currentTime = target;
  setTimeout(() => { ignoreSyncEvent = false; }, 150);
  logOnce(`[SYNC] JUMP to ${target.toFixed(2)}`);
}

function syncPlayPause(paused) {
  ignoreSyncEvent = true;
  if (paused) {
    player.pause();
  } else if (player.paused) {
    player.play().catch(() => {});
  }
  setTimeout(() => { ignoreSyncEvent = false; }, 150);
}

// --- Синхронизация main ---
let mobileAutoplayPauseBug = false;
let firstSyncDone         = false;

function applySyncState(data) {
  if (!metadataReady) return;
  if (!player.muted) player.muted = true;

  const now   = Date.now();
  const delta = (now - data.updatedAt) / 1000;
  const goal  = data.is_paused ? data.position : data.position + delta;

  if (Math.abs(player.currentTime - goal) > 0.5) {
    jumpTo(goal);
  }

  if (!firstSyncDone) {
    mobileAutoplayPauseBug = true;
    firstSyncDone = true;
  }

  syncPlayPause(data.is_paused);

  updateProgressBar();
  readyForControl = true;
  enableControls();
}

let lastPlanB = 0;
function planB_RequestServerState() {
  const now = Date.now();
  if (now - lastPlanB < 4000) return;
  lastPlanB = now;
  socket.emit('request_state', { roomId });
}

socket.on('sync_state', data => {
  applySyncState(data);
  clearTimeout(syncErrorTimeout);
  syncErrorTimeout = setTimeout(() => {
    if (Date.now() - data.updatedAt > 1600) {
      planB_RequestServerState();
    }
  }, 1700);
});

// Надёжная отправка player_action
function emitSyncState() {
  if (!player) return;
  socket.timeout(5000).emit('player_action', {
    roomId,
    position: player.currentTime,
    is_paused: player.paused
  }, (err) => {
    if (err) {
      console.warn('Ошибка синхронизации действия:', err);
    }
  });
  logOnce(`[EMIT] pos=${player.currentTime.toFixed(2)} paused=${player.paused}`);
}

// --- Обработка visibilitychange ---
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    wasPausedOnHide = player.paused;
    ignoreSyncEvent = true;
  } else {
    ignoreSyncEvent = false;
    socket.emit('request_state', { roomId });
    if (!wasPausedOnHide) {
      player.play().catch(() => {});
    }
  }
});

// --- Видео + UI ---
async function fetchRoom() {
  try {
    const res = await fetch(`${BACKEND}/api/rooms/${roomId}`);
    if (!res.ok) throw new Error(res.status);
    const { movie_id } = await res.json();
    const movie = movies.find(m => m.id === movie_id);
    if (!movie?.videoUrl) throw new Error('Фильм не найден');
    backLink.href = `${movie.html}?id=${movie.id}`;

    if (window.Hls?.isSupported()) {
      const hls = new Hls();
      hls.loadSource(movie.videoUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.ERROR, () => planB_RequestServerState());
      video.addEventListener('waiting', showSpinner);
      video.addEventListener('playing', hideSpinner);
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = movie.videoUrl;
    } else {
      throw new Error('HLS не поддерживается');
    }

    video.addEventListener('loadedmetadata', () => {
      metadataReady = true;
      player = video;
      skipFirstPause = false;
      socket.emit('request_state', { roomId });
      durationLabel.textContent = formatTime(player.duration || 0);
    });

    video.addEventListener('timeupdate', updateProgressBar);
    video.addEventListener('durationchange', () => {
      durationLabel.textContent = formatTime(player.duration || 0);
    });

    setupCustomControls();
    showSpinner();
  } catch (err) {
    console.error(err);
    playerWrapper.innerHTML = `<p class="error">Ошибка: ${err.message}</p>`;
  }
}

function setupCustomControls() {
  playPauseBtn.addEventListener('click', () => {
    if (!readyForControl) return;
    isUserAction = true;
    if (player.paused) player.play();
    else             player.pause();
  });
  muteBtn.addEventListener('click', () => {
    if (!readyForControl) return;
    player.muted = !player.muted;
    updateMuteIcon();
  });
  fullscreenBtn.addEventListener('click', () => {
    if (!readyForControl) return;
    const fn = player.requestFullscreen
             || player.webkitRequestFullscreen
             || player.msRequestFullscreen;
    fn && fn.call(player);
  });

  // SCRUBBING
  let wasPlaying = false;

  progressSlider.addEventListener('mousedown', () => {
    wasPlaying = !player.paused;
  });
  progressSlider.addEventListener('input', () => {
    const pct = progressSlider.value / 100;
    player.currentTime = pct * player.duration;
  });
  progressSlider.addEventListener('mouseup', () => {
    emitSyncState();
    if (wasPlaying) player.play().catch(() => {});
  });

  player.addEventListener('play', () => {
    if (!ignoreSyncEvent && isUserAction) emitSyncState();
    isUserAction = false;
    updatePlayIcon();
  });
  player.addEventListener('pause', () => {
    if (skipFirstPause) {
      skipFirstPause = false;
      updatePlayIcon();
      return;
    }
    if (!ignoreSyncEvent && isUserAction) emitSyncState();
    isUserAction = false;
    updatePlayIcon();
  });
  player.addEventListener('seeked', () => {
    if (!ignoreSyncEvent) emitSyncState();
  });
  player.addEventListener('volumechange', updateMuteIcon);
}

function updateProgressBar() {
  if (!player.duration) return;
  const pct = (player.currentTime / player.duration) * 100;
  progressBar.style.width = pct + '%';
  progressSlider.value    = pct;
  currentTimeLabel.textContent = formatTime(player.currentTime);
}

function updatePlayIcon() {
  playPauseBtn.textContent = player.paused ? '▶️' : '⏸️';
}
function updateMuteIcon() {
  muteBtn.textContent = (player.muted || player.volume === 0) ? '🔇' : '🔊';
}

function showSpinner() {
  if (!spinner) {
    spinner = createSpinner();
    playerWrapper.appendChild(spinner);
  }
  spinner.style.display = 'block';
}
function hideSpinner() {
  spinner && (spinner.style.display = 'none');
}
function createSpinner() {
  const s = document.createElement('div');
  s.className = 'buffer-spinner';
  s.innerHTML = `<div class="double-bounce1"></div><div class="double-bounce2"></div>`;
  s.style.display = 'none';
  return s;
}

function formatTime(t) {
  t = Math.floor(t || 0);
  if (t >= 3600) {
    return `${Math.floor(t/3600)}:${String(Math.floor((t%3600)/60)).padStart(2,'0')}:${String(t%60).padStart(2,'0')}`;
  }
  return `${Math.floor(t/60)}:${String(t%60).padStart(2,'0')}`;
}
