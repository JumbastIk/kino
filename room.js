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
const playerWrapper   = document.getElementById('playerWrapper');
const video           = document.getElementById('videoPlayer');
const playPauseBtn    = document.getElementById('playPauseBtn');
const muteBtn         = document.getElementById('muteBtn');
const fullscreenBtn   = document.getElementById('fullscreenBtn');
const progressContainer = document.getElementById('progressContainer');
const progressBar       = document.getElementById('progressBar');
const currentTimeLabel  = document.getElementById('currentTimeLabel');
const durationLabel     = document.getElementById('durationLabel');
const chatSidebar       = document.getElementById('chatSidebar');
const closeChatBtn      = document.getElementById('closeChatBtn');
const chatBottom        = document.getElementById('chatBottom');
const messagesBox       = document.getElementById('messages');
const membersList       = document.getElementById('membersList');
const msgInput          = document.getElementById('msgInput');
const sendBtn           = document.getElementById('sendBtn');
const backLink          = document.getElementById('backLink');
const roomIdCode        = document.getElementById('roomIdCode');
const copyRoomId        = document.getElementById('copyRoomId');

if (roomIdCode) roomIdCode.textContent = roomId;
if (copyRoomId) copyRoomId.onclick = () => {
  navigator.clipboard.writeText(roomId);
  alert('Скопировано!');
};

let player = video, spinner, lastPing = 0, myUserId = null;
let metadataReady = false, lastSyncLog = 0;
let ignoreSyncEvent = false, lastSyncApply = 0, syncProblemDetected = false, syncErrorTimeout = null;
let readyForControl = false;

let allMembers = [];
let userTimeMap = {};
let userPingMap = {};

disableControls();
function enableControls() {
  playPauseBtn.style.pointerEvents     = '';
  muteBtn.style.pointerEvents          = '';
  fullscreenBtn.style.pointerEvents    = '';
  progressContainer.style.pointerEvents = '';
  playPauseBtn.style.opacity           = '';
  muteBtn.style.opacity                = '';
  fullscreenBtn.style.opacity          = '';
  progressContainer.style.opacity      = '';
}
function disableControls() {
  playPauseBtn.style.pointerEvents     = 'none';
  muteBtn.style.pointerEvents          = 'none';
  fullscreenBtn.style.pointerEvents    = 'none';
  progressContainer.style.pointerEvents = 'none';
  playPauseBtn.style.opacity           = '.6';
  muteBtn.style.opacity                = '.6';
  fullscreenBtn.style.opacity          = '.6';
  progressContainer.style.opacity      = '.6';
}

function appendMessage(author, text) {
  const d1 = document.createElement('div');
  d1.className = 'chat-message';
  d1.innerHTML = `<strong>${author}:</strong> ${text}`;
  messagesBox.appendChild(d1);
  messagesBox.scrollTop = messagesBox.scrollHeight;
}
function appendSystemMessage(text) {
  const d1 = document.createElement('div');
  d1.className = 'chat-message system-message';
  d1.innerHTML = `<em>${text}</em>`;
  messagesBox.appendChild(d1);
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

function logOnce(msg) {
  const now = Date.now();
  if (now - lastSyncLog > 600) {
    console.log(msg);
    lastSyncLog = now;
  }
}
function log(msg) { console.log(msg); }

function measurePingAndSend() {
  if (!player || !myUserId) return;
  const t0 = Date.now();
  socket.emit('ping');
  socket.once('pong', () => {
    const myPing = Date.now() - t0;
    userPingMap[myUserId] = myPing;
    userTimeMap[myUserId] = player.currentTime;
    socket.emit('update_time', {
      roomId,
      user_id: myUserId,
      currentTime: player.currentTime,
      ping: myPing
    });
  });
}
setInterval(measurePingAndSend, 1000);

socket.on('user_time_update', data => {
  if (data && data.user_id) {
    userTimeMap[data.user_id] = data.currentTime;
    userPingMap[data.user_id] = data.ping;
    updateMembersList();
  }
});

socket.on('connect', () => {
  myUserId = socket.id;
  log(`[connect] id=${myUserId}`);
  socket.emit('join', { roomId, userData: { id: myUserId, first_name: 'Гость' } });
  socket.emit('request_state', { roomId });
  fetchRoom();
});
socket.on('reconnect', () => {
  log('[reconnect]');
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
socket.on('chat_message', m => {
  appendMessage(m.author, m.text);
});
socket.on('system_message', msg => {
  if (msg?.text) appendSystemMessage(msg.text);
});

function updateMembersList() {
  if (!Array.isArray(allMembers)) return;
  membersList.innerHTML =
    allMembers
      .map(m => {
        const userId = m.user_id || m.id || '';
        const displayName = m.first_name || userId;
        const curTime = userTimeMap[userId] ?? 0;
        const ping = userPingMap[userId] ?? '-';
        return `<li>
          <span class="member-name">${displayName}</span>
          <span class="member-time" style="margin-left:8px;font-family:monospace">${formatTime(curTime)}</span>
          <span class="member-ping" style="margin-left:7px;font-size:12px;color:#a970ff;">${ping}ms</span>
        </li>`;
      })
      .join('');
}

// --- СИНХРОНИЗАЦИЯ ---
function applySyncState(data) {
  if (!metadataReady || !player) return;
  const now = Date.now();
  const timeSinceUpdate = (now - data.updatedAt) / 1000;
  const target = data.is_paused ? data.position : data.position + timeSinceUpdate;

  // ВАЖНО: ВСЕГДА доверяем sync_state, даже если только что кто-то перезашёл!
  if (Math.abs(player.currentTime - target) > 0.5) {
    ignoreSyncEvent = true;
    player.currentTime = target;
    setTimeout(() => { ignoreSyncEvent = false; }, 150);
    logOnce(`[SYNC] JUMP to ${target.toFixed(2)}`);
  }
  if (data.is_paused && !player.paused) {
    ignoreSyncEvent = true;
    player.pause();
    setTimeout(() => { ignoreSyncEvent = false; }, 150);
    logOnce('[SYNC] pause');
  }
  if (!data.is_paused && player.paused) {
    ignoreSyncEvent = true;
    player.play().then(() => {
      setTimeout(() => { ignoreSyncEvent = false; }, 150);
      logOnce('[SYNC] play');
    }).catch(() => { ignoreSyncEvent = false; });
  }
  lastSyncApply = Date.now();
  syncProblemDetected = false;
  if (syncErrorTimeout) {
    clearTimeout(syncErrorTimeout);
    syncErrorTimeout = null;
  }
  updateProgressBar();
  // ВСЕГДА после sync_state делаем enableControls!
  readyForControl = true;
  enableControls();
  hideSpinner();
}

let lastPlanB = 0;
function planB_RequestServerState() {
  const now = Date.now();
  if (now - lastPlanB < 4000) return;
  lastPlanB = now;
  logOnce('[PLAN B] Force re-sync: request_state');
  socket.emit('request_state', { roomId });
}

socket.on('sync_state', data => {
  applySyncState(data);
  if (syncErrorTimeout) clearTimeout(syncErrorTimeout);
  syncErrorTimeout = setTimeout(() => {
    if (Date.now() - lastSyncApply > 1600) {
      syncProblemDetected = true;
      planB_RequestServerState();
    }
  }, 1700);
});
function emitSyncState() {
  if (!player) return;
  socket.emit('player_action', {
    roomId,
    position: player.currentTime,
    is_paused: player.paused
  });
  logOnce(`[EMIT] pos=${player.currentTime.toFixed(2)} paused=${player.paused}`);
}

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
      hls.on(Hls.Events.ERROR, (e, data) => {
        log(`[HLS ERROR]`, data);
        planB_RequestServerState();
      });
      video.addEventListener('waiting', showSpinner);
      video.addEventListener('playing', hideSpinner);
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = movie.videoUrl;
    } else throw new Error('HLS не поддерживается');
    video.addEventListener('loadedmetadata', () => {
      metadataReady = true;
      setupSyncHandlers(video);
      player = video;
      socket.emit('request_state', { roomId });
      durationLabel.textContent = formatTime(player.duration || 0);
      logOnce('[player] loadedmetadata');
    });
    video.addEventListener('timeupdate', updateProgressBar);
    video.addEventListener('durationchange', () => {
      durationLabel.textContent = formatTime(player.duration || 0);
    });
    setupCustomControls();
    showSpinner();
    logOnce('[player] инициализирован');
  } catch (err) {
    console.error(err);
    playerWrapper.innerHTML = `<p class="error">Ошибка: ${err.message}</p>`;
  }
}

function setupCustomControls() {
  playPauseBtn.addEventListener('click', () => {
    if (!readyForControl) return;
    if (player.paused) player.play();
    else player.pause();
  });
  muteBtn.addEventListener('click', () => {
    if (!readyForControl) return;
    player.muted = !player.muted;
    updateMuteIcon();
  });
  fullscreenBtn.addEventListener('click', () => {
    if (!readyForControl) return;
    if (player.requestFullscreen) player.requestFullscreen();
    else if (player.webkitRequestFullscreen) player.webkitRequestFullscreen();
    else if (player.msRequestFullscreen) player.msRequestFullscreen();
  });

  progressContainer.addEventListener('click', e => {
    if (!readyForControl) return;
    const rect = progressContainer.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
    player.currentTime = player.duration * percent;
    emitSyncState();
  });

  player.addEventListener('play',   () => { if (!ignoreSyncEvent) emitSyncState(); updatePlayIcon(); });
  player.addEventListener('pause',  () => { if (!ignoreSyncEvent) emitSyncState(); updatePlayIcon(); });
  player.addEventListener('seeked', () => { if (!ignoreSyncEvent) emitSyncState(); });
  player.addEventListener('volumechange', updateMuteIcon);

  updatePlayIcon();
  updateMuteIcon();
}

function setupSyncHandlers(v) {
  v.addEventListener('play',   () => { if (!ignoreSyncEvent) emitSyncState(); });
  v.addEventListener('pause',  () => { if (!ignoreSyncEvent) emitSyncState(); });
  v.addEventListener('seeked', () => { if (!ignoreSyncEvent) emitSyncState(); });
  v.addEventListener('error',  () => planB_RequestServerState());
  v.addEventListener('stalled',() => planB_RequestServerState());
}

function updateProgressBar() {
  if (!player.duration) return;
  const percent = (player.currentTime / player.duration) * 100;
  progressBar.style.width = percent + '%';
  currentTimeLabel.textContent = formatTime(player.currentTime);
  durationLabel.textContent = formatTime(player.duration);
}

function updatePlayIcon() {
  playPauseBtn.textContent = player.paused ? '▶️' : '⏸️';
}

function updateMuteIcon() {
  muteBtn.textContent = player.muted || player.volume === 0 ? '🔇' : '🔊';
}

function showSpinner() {
  if (!spinner) {
    spinner = createSpinner();
    playerWrapper.appendChild(spinner);
  }
  spinner.style.display = 'block';
}
function hideSpinner() {
  if (spinner) spinner.style.display = 'none';
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
  if (t >= 3600) return `${Math.floor(t/3600)}:${String(Math.floor((t%3600)/60)).padStart(2,'0')}:${String(t%60).padStart(2,'0')}`;
  else return `${Math.floor(t/60)}:${String(t%60).padStart(2,'0')}`;
}
