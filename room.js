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
const progressSlider    = document.getElementById('progressSlider');
const progressContainer = document.getElementById('progressContainer');
const progressBar       = document.getElementById('progressBar');
const currentTimeLabel  = document.getElementById('currentTimeLabel');
const leftTimeLabel     = document.getElementById('leftTimeLabel'); // новый label
const durationLabel     = document.getElementById('durationLabel');
const messagesBox       = document.getElementById('messages');
const membersList       = document.getElementById('membersList');
const msgInput          = document.getElementById('msgInput');
const sendBtn           = document.getElementById('sendBtn');
const backLink          = document.getElementById('backLink');
const roomIdCode        = document.getElementById('roomIdCode');
const copyRoomId        = document.getElementById('copyRoomId');

// КНОПКА КАЧЕСТВА!
const qualitySelect     = document.getElementById('qualitySelect');

// SVG icons
const iconPlay    = document.getElementById('iconPlay');
const iconPause   = document.getElementById('iconPause');
const iconVolOn   = document.getElementById('iconVolOn');
const iconVolOff  = document.getElementById('iconVolOff');

// ===== Индикатор статуса соединения =====
const statusBar = document.createElement('div');
statusBar.style.position = 'fixed';
statusBar.style.bottom = '18px';
statusBar.style.left = '50%';
statusBar.style.transform = 'translateX(-50%)';
statusBar.style.padding = '10px 18px';
statusBar.style.background = '#23232cde';
statusBar.style.color = '#ff9696';
statusBar.style.zIndex = '20000';
statusBar.style.fontSize = '15px';
statusBar.style.borderRadius = '18px';
statusBar.style.display = 'none';
document.body.appendChild(statusBar);
// PATCH: теперь может быть кнопка
function showStatus(msg, color = '#ff9696', btnText = '', btnHandler = null) {
  statusBar.textContent = msg;
  statusBar.style.background = color;
  statusBar.style.display = '';
  if (btnText && typeof btnHandler === 'function') {
    const btn = document.createElement('button');
    btn.textContent = btnText;
    btn.style.marginLeft = '15px';
    btn.style.background = '#fff2';
    btn.style.border = 'none';
    btn.style.borderRadius = '8px';
    btn.style.padding = '2px 10px';
    btn.style.color = '#ffb';
    btn.style.cursor = 'pointer';
    btn.onclick = btnHandler;
    statusBar.appendChild(btn);
  }
}
function hideStatus() {
  statusBar.style.display = 'none';
}

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

// PATCH: Антиспам для ручных действий (play/pause/seek)
let lastUserAction = 0;
function canUserAction() {
  let now = Date.now();
  if (now - lastUserAction < 300) return false;
  lastUserAction = now;
  return true;
}

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

// ===== 1.1. Sanitize XSS + лимит длины чата =====
function escapeHtml(str) {
  return String(str).replace(/[&<>"'`=\/]/g, function(s) {
    return ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;',
      '=': '&#61;', '/': '&#47;'
    })[s];
  });
}
function appendMessage(author, text) {
  const d = document.createElement('div');
  d.className = 'chat-message';
  d.innerHTML = `<strong>${escapeHtml(author)}:</strong> ${escapeHtml(text)}`;
  messagesBox.appendChild(d);
  messagesBox.scrollTop = messagesBox.scrollHeight;
}
function appendSystemMessage(text) {
  const d = document.createElement('div');
  d.className = 'chat-message system-message';
  d.innerHTML = `<em>${escapeHtml(text)}</em>`;
  messagesBox.appendChild(d);
  messagesBox.scrollTop = messagesBox.scrollHeight;
}
sendBtn.addEventListener('click', sendMessage);
msgInput.addEventListener('keydown', e => { if (e.key === 'Enter') sendMessage(); });
function sendMessage() {
  const t = msgInput.value.trim();
  if (!t) return;
  if (t.length > 1000) {
    showStatus('Сообщение слишком длинное!', '#a23');
    setTimeout(hideStatus, 1500);
    return;
  }
  socket.emit('chat_message', { roomId, author: 'Гость', text: t });
  msgInput.value = '';
}

// ===== 1.6. Централизованный logError =====
function logError(msg, err) {
  console.error('[Room Error]', msg, err || '');
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

// ===== 1.8. Watchdog автосинхронизация (деликатно) =====
function getMedianTime() {
  const times = Object.values(userTimeMap).filter(t => typeof t === 'number');
  if (!times.length) return player.currentTime;
  times.sort((a, b) => a - b);
  const mid = Math.floor(times.length / 2);
  return times.length % 2 === 0 ? (times[mid - 1] + times[mid]) / 2 : times[mid];
}
setInterval(() => {
  if (!readyForControl) return;
  const median = getMedianTime();
  const delta = Math.abs(player.currentTime - median);
  if (delta > 2.3 && delta < 30 && !player.paused) {
    logOnce('Watchdog: Автосинхронизация (дельта ' + delta.toFixed(2) + ' сек.)');
    player.currentTime = median;
  }
}, 7000);

// --- Сокет-события ---
socket.on('connect', () => {
  myUserId = socket.id;
  readyForControl = false;
  disableControls();
  hideStatus();
  socket.emit('join', { roomId, userData: { id: myUserId, first_name: 'Гость' } });
  socket.emit('request_state', { roomId });
  fetchRoom();
});
socket.on('disconnect', () => {
  showStatus('Отключено от сервера. Ждем восстановления…', '#fc8');
});
socket.on('reconnect_attempt', () => {
  showStatus('Пытаемся восстановить соединение…', '#fb4343');
});
socket.on('reconnect', () => {
  hideStatus();
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
function jumpTo(target, source = 'REMOTE') {
  ignoreSyncEvent = true;
  if (player.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    const onLoaded = () => {
      player.currentTime = target;
      player.removeEventListener('loadeddata', onLoaded);
      setTimeout(() => { ignoreSyncEvent = false; }, 150);
    };
    player.addEventListener('loadeddata', onLoaded);
  } else {
    player.currentTime = target;
    setTimeout(() => { ignoreSyncEvent = false; }, 150);
  }
  logOnce(`[SYNC] JUMP to ${target.toFixed(2)} (${source})`);
}

function syncPlayPause(paused, source = 'REMOTE') {
  ignoreSyncEvent = true;
  if (paused) {
    player.pause();
    setTimeout(() => { ignoreSyncEvent = false; }, 150);
  } else {
    player.play().catch(()=>{}).finally(() => {
      setTimeout(() => { ignoreSyncEvent = false; }, 150);
    });
  }
  logOnce(`[SYNC] ${paused ? 'PAUSE' : 'PLAY'} (${source})`);
}

// --- Синхронизация main ---
let firstSyncDone = false;
let lastPlanB = 0;
let planBAttempts = 0;
function planB_RequestServerState() {
  const now = Date.now();
  if (now - lastPlanB < 4000) return;
  lastPlanB = now;
  planBAttempts++;
  if (planBAttempts > 3) {
    showStatus('Нет ответа от сервера. Переподключить?', '#f44', 'Переподключить', () => {
      location.reload();
    });
  }
  socket.emit('request_state', { roomId });
}

function applySyncState(data) {
  if (!metadataReady) return;
  if (!player.muted) player.muted = true;

  let delta = (Date.now() - data.updatedAt) / 1000;
  if (delta < 0) delta = 0;

  const raw = data.is_paused
            ? data.position
            : data.position + delta;
  const duration = player.duration || Infinity;
  const target   = Math.min(Math.max(raw, 0), duration);

  if (Math.abs(player.currentTime - target) > 0.5) {
    jumpTo(target, 'REMOTE');
  }

  if (!firstSyncDone) {
    firstSyncDone = true;
  }

  syncPlayPause(data.is_paused, 'REMOTE');

  updateProgressBar();
  readyForControl = true;
  enableControls();
}

socket.on('sync_state', data => {
  planBAttempts = 0;
  applySyncState(data);
  clearTimeout(syncErrorTimeout);
  syncErrorTimeout = setTimeout(() => {
    if (Date.now() - data.updatedAt > 1600) {
      planB_RequestServerState();
    }
  }, 1700);
});

function emitSyncState(source = 'USER') {
  if (!player) return;
  socket.emit('player_action', {
    roomId,
    position: player.currentTime,
    is_paused: player.paused
  });
  logOnce(`[EMIT] pos=${player.currentTime.toFixed(2)} paused=${player.paused} (${source})`);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    wasPausedOnHide = player.paused;
    ignoreSyncEvent = true;
  } else {
    ignoreSyncEvent = false;
    socket.emit('request_state', { roomId });
    setTimeout(() => socket.emit('request_state', { roomId }), 1000);
    if (!wasPausedOnHide) {
      player.play().catch(() => {});
    }
  }
});

async function fetchRoom() {
  try {
    const res = await fetch(`${BACKEND}/api/rooms/${roomId}`);
    if (!res.ok) throw new Error(res.status + ' ' + res.statusText);
    const { movie_id } = await res.json();
    const movie = movies.find(m => m.id === movie_id);
    if (!movie?.videoUrl) throw new Error('Фильм не найден');
    backLink.href = `${movie.html}?id=${movie.id}`;

    // --- HLS.js + выбор качества
    if (window.Hls?.isSupported()) {
      const hls = new Hls();
      hls.loadSource(movie.videoUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.ERROR, () => planB_RequestServerState());
      video.addEventListener('waiting', showSpinner);
      video.addEventListener('playing', hideSpinner);

      // КАЧЕСТВО: выбираем варианты
      hls.on(Hls.Events.MANIFEST_PARSED, function (event, data) {
        if (!qualitySelect) return;
        qualitySelect.innerHTML = '';
        if (data.levels && data.levels.length > 1) {
          qualitySelect.style.display = '';
          data.levels.forEach((level, i) => {
            const opt = document.createElement('option');
            opt.value = i;
            opt.text = `${level.height}p (${Math.round(level.bitrate / 1000)}kbps)`;
            qualitySelect.appendChild(opt);
          });
          // текущий уровень
          qualitySelect.value = hls.currentLevel;
          qualitySelect.onchange = function () {
            hls.currentLevel = parseInt(this.value);
          };
        } else {
          qualitySelect.style.display = 'none';
        }
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = movie.videoUrl;
      if (qualitySelect) qualitySelect.style.display = 'none';
    } else {
      throw new Error('HLS не поддерживается');
    }

    video.addEventListener('loadedmetadata', () => {
      metadataReady = true;
      player = video;
      socket.emit('request_state', { roomId });
      durationLabel.textContent = formatTime(player.duration || 0);
      updateTimeLabels();
    });

    video.addEventListener('timeupdate', updateProgressBar);
    video.addEventListener('timeupdate', updateTimeLabels);
    video.addEventListener('durationchange', () => {
      durationLabel.textContent = formatTime(player.duration || 0);
      updateTimeLabels();
    });

    setupCustomControls();
    showSpinner();
  } catch (err) {
    logError(err.message, err);
    playerWrapper.innerHTML = `<p class="error">Ошибка: ${escapeHtml(err.message)}</p>`;
    showStatus('Ошибка при получении данных.', '#f44', 'Попробовать снова', () => {
      hideStatus();
      playerWrapper.innerHTML = '';
      fetchRoom();
    });
  }
}

function setupCustomControls() {
  playPauseBtn.addEventListener('click', () => {
    if (!readyForControl) return;
    if (!canUserAction()) return;
    if (player.paused) player.play();
    else               player.pause();
    emitSyncState('USER');
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

  let wasPlaying = false;
  progressSlider.addEventListener('mousedown', () => {
    wasPlaying = !player.paused;
  });
  progressSlider.addEventListener('input', () => {
    const pct = progressSlider.value / 100;
    player.currentTime = pct * player.duration;
    updateTimeLabels();
  });
  progressSlider.addEventListener('mouseup', () => {
    if (!canUserAction()) return;
    emitSyncState('USER');
    if (wasPlaying) player.play().catch(() => {});
  });

  player.addEventListener('play', updatePlayIcon);
  player.addEventListener('pause', updatePlayIcon);
  player.addEventListener('volumechange', updateMuteIcon);

  updatePlayIcon();
  updateMuteIcon();
  updateTimeLabels();
}

function updateProgressBar() {
  if (!player.duration) return;
  const pct = (player.currentTime / player.duration) * 100;
  progressBar.style.width = pct + '%';
  progressSlider.value    = pct;
}

function updatePlayIcon() {
  if (!iconPlay || !iconPause) return;
  if (player.paused) {
    iconPlay.style.display = '';
    iconPause.style.display = 'none';
  } else {
    iconPlay.style.display = 'none';
    iconPause.style.display = '';
  }
}
function updateMuteIcon() {
  if (!iconVolOn || !iconVolOff) return;
  if (player.muted || player.volume === 0) {
    iconVolOn.style.display = 'none';
    iconVolOff.style.display = '';
  } else {
    iconVolOn.style.display = '';
    iconVolOff.style.display = 'none';
  }
}

function updateTimeLabels() {
  if (!leftTimeLabel) return;
  currentTimeLabel.textContent = formatTime(player.currentTime);
  const remain = Math.max(0, (player.duration || 0) - player.currentTime);
  leftTimeLabel.textContent = '-' + formatTime(remain);
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

// ===== 1.10. SanityCheck (ручная проверка функций) =====
function sanityCheck() {
  try {
    [
      playerWrapper, video, playPauseBtn, muteBtn, fullscreenBtn, progressSlider,
      progressContainer, progressBar, currentTimeLabel, durationLabel,
      messagesBox, membersList, msgInput, sendBtn
    ].forEach(el => {
      if (!el) throw new Error('Отсутствует элемент: ' + (el && el.id));
    });
    if (!socket) throw new Error('Socket не инициализирован');
    if (typeof getMedianTime !== 'function') throw new Error('Watchdog не работает');
    console.log('SanityCheck: OK');
  } catch (e) {
    logError('SanityCheck fail', e);
    showStatus('Критическая ошибка. Перезагрузите страницу.', '#f44');
  }
}
window.addEventListener('DOMContentLoaded', sanityCheck);
