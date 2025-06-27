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

const playerWrapper = document.getElementById('playerWrapper');
const backLink      = document.getElementById('backLink');
const messagesBox   = document.getElementById('messages');
const membersList   = document.getElementById('membersList');
const msgInput      = document.getElementById('msgInput');
const sendBtn       = document.getElementById('sendBtn');

let player, spinner, lastPing = 0, myUserId = null, initialSync = null;
let metadataReady = false, lastSyncLog = 0;

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

// --- НАДЁЖНАЯ СИНХРОНИЗАЦИЯ --- //
let ignoreSyncEvent = false;
let syncInProgress = false;
let justSeeked = false; // Новый флаг

// "План Б" для авто-восстановления sync-зацикливания
let syncHistory = [];
let syncBlockUntil = 0;
const SYNC_LOOP_WINDOW = 1000; // 1 секунда
const SYNC_LOOP_THRESHOLD = 5; // сколько событий в окне считать за "зацикливание"
const SYNC_BLOCK_MS = 1200; // время блокировки sync после "Плана Б"

socket.on('sync_state', data => {
  if (!metadataReady || !player) return;
  if (Date.now() < syncBlockUntil) return;
  if (syncInProgress) return;

  const now = Date.now();
  const timeSinceUpdate = (now - data.updatedAt) / 1000;
  const target = data.is_paused ? data.position : data.position + timeSinceUpdate;

  // Сохраняем последние sync
  syncHistory.push(now);
  syncHistory = syncHistory.filter(t => now - t < SYNC_LOOP_WINDOW);
  if (syncHistory.length > SYNC_LOOP_THRESHOLD) {
    logOnce('[SYNC][ПланБ] Detected loop, force-recover');
    syncBlockUntil = now + SYNC_BLOCK_MS;
    syncHistory = [];
    forceRecoverState(data, target);
    return;
  }

  // --- Точечная синхронизация времени ---
  // Только если рассинхрон >0.4s — прыгаем (но не ставим на паузу если playing!)
  if (Math.abs(player.currentTime - target) > 0.4) {
    ignoreSyncEvent = true;
    syncInProgress = true;
    justSeeked = true;
    player.currentTime = target;
    setTimeout(() => {
      ignoreSyncEvent = false;
      syncInProgress = false;
      justSeeked = false;
    }, 200);
    logOnce(`[SYNC] JUMP to ${target.toFixed(2)}`);
    // После прыжка — не переключаем play/pause насильно!
    // Это фиксирует твою проблему — не будет паузы после перемотки если нужно playing
    if (!data.is_paused && player.paused) {
      player.play().catch(() => {});
    }
    if (data.is_paused && !player.paused) {
      player.pause();
    }
    return; // Уже всё сделали
  }

  // --- Корректируем только play/pause если не было seek ---
  if (data.is_paused && !player.paused) {
    ignoreSyncEvent = true;
    syncInProgress = true;
    player.pause();
    setTimeout(() => {
      ignoreSyncEvent = false;
      syncInProgress = false;
    }, 160);
    logOnce('[SYNC] pause');
  } else if (!data.is_paused && player.paused && !justSeeked) {
    ignoreSyncEvent = true;
    syncInProgress = true;
    player.play().then(() => {
      setTimeout(() => {
        ignoreSyncEvent = false;
        syncInProgress = false;
      }, 160);
      logOnce('[SYNC] play');
    }).catch(() => {
      ignoreSyncEvent = false;
      syncInProgress = false;
    });
  }
});

// План Б: если sync завис, форсируем сброс и возвращаем play/pause
function forceRecoverState(data, target) {
  ignoreSyncEvent = true;
  syncInProgress = true;
  player.currentTime = target;
  setTimeout(() => {
    if (!data.is_paused) {
      player.play().then(() => {
        ignoreSyncEvent = false;
        syncInProgress = false;
        logOnce('[ПланБ] force play');
      }).catch(() => {
        ignoreSyncEvent = false;
        syncInProgress = false;
      });
    } else {
      player.pause();
      ignoreSyncEvent = false;
      syncInProgress = false;
      logOnce('[ПланБ] force pause');
    }
  }, 250);
}

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
  v.addEventListener('play',   () => { if (!ignoreSyncEvent && !syncInProgress) emitSyncState(); });
  v.addEventListener('pause',  () => { if (!ignoreSyncEvent && !syncInProgress) emitSyncState(); });
  v.addEventListener('seeked', () => { if (!ignoreSyncEvent && !syncInProgress) emitSyncState(); });
}

// --- Видео-плеер + UI --- //
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
        log(`[HLS ERROR]`, data);
        spinner.style.display = 'none';
      });
      v.addEventListener('waiting', () => spinner.style.display = 'block');
      v.addEventListener('playing', () => spinner.style.display = 'none');
    } else if (v.canPlayType('application/vnd.apple.mpegurl')) {
      v.src = movie.videoUrl;
    } else throw new Error('HLS не поддерживается');

    v.addEventListener('loadedmetadata', () => {
      metadataReady = true;
      setupSyncHandlers(v);
      player = v;
      if (initialSync) socket.emit('request_state', { roomId });
      logOnce('[player] loadedmetadata');
    });

    player = v;
    logOnce('[player] инициализирован');
  } catch (err) {
    console.error(err);
    playerWrapper.innerHTML = `<p class="error">Ошибка: ${err.message}</p>`;
  }
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
