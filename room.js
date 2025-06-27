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

const playerWrapper   = document.getElementById('playerWrapper');
const backLink        = document.getElementById('backLink');
const messagesBox     = document.getElementById('messages');
const membersList     = document.getElementById('membersList');
const msgInput        = document.getElementById('msgInput');
const sendBtn         = document.getElementById('sendBtn');

const player          = document.getElementById('videoPlayer');
const playPauseBtn    = document.getElementById('playPauseBtn');
const muteBtn         = document.getElementById('muteBtn');
const fullscreenBtn   = document.getElementById('fullscreenBtn');
const progressBar     = document.getElementById('progressBar');
const progressCont    = document.getElementById('progressContainer');
const timeLabel       = document.getElementById('currentTimeLabel');
const durationLabel   = document.getElementById('durationLabel');
const openChatBtn     = document.getElementById('openChatBtn');
const chatSidebar     = document.getElementById('chatSidebar');
const closeChatBtn    = document.getElementById('closeChatBtn');

let spinner, lastPing = 0, myUserId = null;
let metadataReady = false, lastSyncLog = 0, videoDuration = 0;
let ignoreSyncEvent = false, lastSyncApply = 0, syncErrorTimeout = null, syncProblemDetected = false;

// Логгер (throttle)
function logOnce(msg) {
  const now = Date.now();
  if (now - lastSyncLog > 600) {
    console.log(msg);
    lastSyncLog = now;
  }
}
function log(msg) { console.log(msg); }

// Пинг
function measurePing() {
  const t0 = Date.now();
  socket.emit('ping');
  socket.once('pong', () => {
    lastPing = Date.now() - t0;
    logOnce(`[PING] ${lastPing} ms`);
  });
}
setInterval(measurePing, 10000);

// --- Подключение и Чат --- //
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
  membersList.innerHTML =
    `<div class="chat-members-label">Участники (${ms.length}):</div>` +
    `<ul>${ms.map(m => `<li>${m.user_id || m.id}</li>`).join('')}</ul>`;
  logOnce(`[members] ${ms.length}: ${ms.map(m => m.user_id || m.id).join(', ')}`);
});
socket.on('history', data => {
  messagesBox.innerHTML = '';
  data.forEach(m => appendMessage(m.author, m.text));
  logOnce(`[history] сообщений: ${data.length}`);
});
socket.on('chat_message', m => {
  logOnce(`[chat] ${m.author}: ${m.text}`);
  appendMessage(m.author, m.text);
});
socket.on('system_message', msg => {
  if (msg?.text) {
    logOnce(`[system] ${msg.text}`);
    appendSystemMessage(msg.text);
  }
});

sendBtn.addEventListener('click', sendMessage);
msgInput.addEventListener('keydown', e => { if (e.key === 'Enter') sendMessage(); });
function sendMessage() {
  const t = msgInput.value.trim();
  if (!t) return;
  socket.emit('chat_message', { roomId, author: 'Гость', text: t });
  msgInput.value = '';
  logOnce(`[chat][me]: ${t}`);
}

// --- СИНХРОНИЗАЦИЯ + Восстановление --- //
function applySyncState(data) {
  if (!metadataReady || !player) return;
  const now = Date.now();
  const timeSinceUpdate = (now - data.updatedAt) / 1000;
  const target = data.is_paused ? data.position : data.position + timeSinceUpdate;

  // Если рассинхрон больше 0.5 сек, корректируем позицию
  if (Math.abs(player.currentTime - target) > 0.5) {
    ignoreSyncEvent = true;
    player.currentTime = target;
    setTimeout(() => { ignoreSyncEvent = false; }, 150);
    logOnce(`[SYNC] JUMP to ${target.toFixed(2)}`);
  }

  // Корректируем play/pause если отличается
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

  // Зафиксировать время последней нормальной синхронизации
  lastSyncApply = Date.now();
  syncProblemDetected = false;
  if (syncErrorTimeout) {
    clearTimeout(syncErrorTimeout);
    syncErrorTimeout = null;
  }
}

// Главное: если клиент подвис/рассинхрон — запросить актуальное состояние с сервера
function planB_RequestServerState() {
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

function setupSyncHandlers(v) {
  v.addEventListener('play',   () => { if (!ignoreSyncEvent) emitSyncState(); });
  v.addEventListener('pause',  () => { if (!ignoreSyncEvent) emitSyncState(); });
  v.addEventListener('seeked', () => { if (!ignoreSyncEvent) emitSyncState(); });
  v.addEventListener('error',  () => planB_RequestServerState());
  v.addEventListener('stalled',() => planB_RequestServerState());
}

// --- Видео-плеер + кастомные контроллы --- //
async function fetchRoom() {
  try {
    const res = await fetch(`${BACKEND}/api/rooms/${roomId}`);
    if (!res.ok) throw new Error(res.status);
    const { movie_id } = await res.json();
    const movie = movies.find(m => m.id === movie_id);
    if (!movie?.videoUrl) throw new Error('Фильм не найден');

    backLink.href = `${movie.html}?id=${movie.id}`;

    // Прячем стандартные контроллы и сбрасываем
    player.removeAttribute('controls');
    player.muted = true;
    player.playsInline = true;
    player.crossOrigin = "anonymous";
    player.src = '';

    spinner = createSpinner();
    if (!playerWrapper.querySelector('.buffer-spinner')) playerWrapper.appendChild(spinner);

    if (window.Hls?.isSupported()) {
      const hls = new Hls();
      hls.loadSource(movie.videoUrl);
      hls.attachMedia(player);
      hls.on(Hls.Events.ERROR, (e, data) => {
        log(`[HLS ERROR]`, data);
        spinner.style.display = 'none';
        planB_RequestServerState();
      });
      player.addEventListener('waiting', () => spinner.style.display = 'block');
      player.addEventListener('playing', () => spinner.style.display = 'none');
    } else if (player.canPlayType('application/vnd.apple.mpegurl')) {
      player.src = movie.videoUrl;
    } else throw new Error('HLS не поддерживается');

    player.addEventListener('loadedmetadata', () => {
      metadataReady = true;
      videoDuration = player.duration;
      updateTimeLabels();
      setupSyncHandlers(player);
      socket.emit('request_state', { roomId });
      logOnce('[player] loadedmetadata');
    });

    player.addEventListener('timeupdate', updateTimeLabels);
    player.addEventListener('durationchange', updateTimeLabels);
    player.addEventListener('ended', () => updatePlayPauseBtn());

    // Кастомные контроллы
    playPauseBtn.addEventListener('click', () => {
      if (player.paused) player.play();
      else player.pause();
    });
    muteBtn.addEventListener('click', () => {
      player.muted = !player.muted;
      updateMuteBtn();
    });
    fullscreenBtn.addEventListener('click', () => {
      if (document.fullscreenElement) document.exitFullscreen();
      else playerWrapper.requestFullscreen();
    });

    // Twitch: кастомный прогрессбар
    progressCont.addEventListener('click', e => {
      const rect = progressCont.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const pct = Math.max(0, Math.min(1, x / rect.width));
      player.currentTime = pct * (player.duration || 0);
      emitSyncState();
    });

    // UI-кнопки для чата (показ/скрытие)
    openChatBtn.addEventListener('click', () => {
      chatSidebar.classList.add('open');
      if (window.innerWidth < 950) chatSidebar.scrollIntoView({behavior:'smooth'});
    });
    closeChatBtn.addEventListener('click', () => {
      chatSidebar.classList.remove('open');
    });

    // При клике вне сайдбара на мобилке — скрыть чат
    document.addEventListener('click', e => {
      if (window.innerWidth < 950 && chatSidebar.classList.contains('open')) {
        if (!chatSidebar.contains(e.target) && !openChatBtn.contains(e.target)) {
          chatSidebar.classList.remove('open');
        }
      }
    });

    updatePlayPauseBtn();
    updateMuteBtn();
    updateTimeLabels();
  } catch (err) {
    console.error(err);
    playerWrapper.innerHTML = `<p class="error">Ошибка: ${err.message}</p>`;
  }
}

// ======= Кастомные контроллы =======
function updatePlayPauseBtn() {
  playPauseBtn.textContent = player.paused ? "▶️" : "⏸";
}
function updateMuteBtn() {
  muteBtn.textContent = player.muted ? "🔇" : "🔊";
}
function updateTimeLabels() {
  timeLabel.textContent = formatTime(player.currentTime);
  durationLabel.textContent = formatTime(player.duration || 0);
  // прогрессбар как у Twitch
  const percent = (player.currentTime / (player.duration || 1));
  progressBar.style.width = (percent * 100) + "%";
  updatePlayPauseBtn();
  updateMuteBtn();
}
function formatTime(sec) {
  if (isNaN(sec)) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// --- UI --- //
function createSpinner() {
  const s = document.createElement('div');
  s.className = 'buffer-spinner';
  s.innerHTML = `<div class="double-bounce1"></div><div class="double-bounce2"></div>`;
  s.style.display = 'none';
  return s;
}
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
