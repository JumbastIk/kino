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

let player, spinner, lastPing = 0, myUserId = null, initialSync = null, syncTimeout = null;
let metadataReady = false, lastSyncLog = 0, localSeek = false, wasPausedBeforeSeek = false;
let ignoreNextEvent = false, lastSent = { time: 0, position: 0, paused: null };

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

// --- СИНХРОНИЗАЦИЯ --- //
socket.on('sync_state', d => {
  logOnce(`[sync_state] ← ${JSON.stringify(d)}`);
  scheduleSync(d, 'sync_state');
});

function scheduleSync(d, source) {
  if (!metadataReady) {
    initialSync = d;
    logOnce(`[scheduleSync][${source}] metadataReady=0 (отложено)`);
    return;
  }
  clearTimeout(syncTimeout);
  syncTimeout = setTimeout(() => doSync(d, source), 100);
}

function doSync({ position: pos, is_paused: isPaused, updatedAt: serverTs }, source = '') {
  if (!player || !metadataReady) {
    log(`[doSync][${source}] !player || !metadataReady`);
    return;
  }

  if (localSeek) {
    player.currentTime = pos;
    logOnce(`⏸ doSync [${source}] SKIP (localSeek) setTime=${pos.toFixed(2)}`);
    localSeek = false;
    return;
  }

  const now = Date.now();
  const rtt = lastPing || 0;
  const drift = ((now - serverTs) / 1000) - (rtt / 2000);
  const targetTime = isPaused ? pos : pos + drift;
  const delta = targetTime - player.currentTime;
  const abs = Math.abs(delta);

  // JUMP > 1.0s
  if (abs > 1.0) {
    logOnce(`✔ doSync [${source}] → JUMP: ${targetTime.toFixed(2)} (cur: ${player.currentTime.toFixed(2)})`);
    player.currentTime = targetTime;
  }
  // Smooth playbackRate
  else if (!isPaused && abs > 0.05) {
    let corr = Math.max(-0.07, Math.min(0.07, delta * 0.42));
    player.playbackRate = 1 + corr;
    logOnce(`✔ doSync [${source}] → RATE: ${player.playbackRate.toFixed(3)} (delta ${delta.toFixed(3)})`);
  } else {
    player.playbackRate = 1;
  }

  ignoreNextEvent = true;

  if (isPaused && !player.paused) {
    player.pause();
    logOnce(`✔ doSync [${source}] → PAUSE`);
  }
  else if (!isPaused && player.paused) {
    player.play().then(() => logOnce(`✔ doSync [${source}] → PLAY`)).catch(() => {});
  }

  setTimeout(() => {
    player.playbackRate = 1;
    ignoreNextEvent = false;
  }, 250);
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
      if (initialSync) doSync(initialSync, 'init');
      logOnce('[player] loadedmetadata');
    });

    // Только РЕАЛЬНЫЕ действия пользователя:
    v.addEventListener('seeking', () => {
      if (!ignoreNextEvent) {
        localSeek = true;
        wasPausedBeforeSeek = v.paused;
        logOnce('[player] seeking');
      }
    });
    v.addEventListener('seeked', () => {
      if (!ignoreNextEvent) {
        setTimeout(() => {
          if (wasPausedBeforeSeek && !v.paused) v.pause();
        }, 0);
        emitAction(v.paused);
        logOnce('[player] seeked emitAction');
      }
      wasPausedBeforeSeek = false;
    });
    v.addEventListener('play', () => {
      if (!ignoreNextEvent && !localSeek) {
        emitAction(false);
        logOnce('[player] play emitAction');
      }
    });
    v.addEventListener('pause', () => {
      if (!ignoreNextEvent && !localSeek) {
        emitAction(true);
        logOnce('[player] pause emitAction');
      }
    });

    player = v;
    logOnce('[player] инициализирован');
  } catch (err) {
    console.error(err);
    playerWrapper.innerHTML = `<p class="error">Ошибка: ${err.message}</p>`;
  }
}

// --- Emit только пользовательских действий --- //
function emitAction(paused) {
  if (!player) return;
  const now = Date.now();
  const position = player.currentTime;

  if (
    now - lastSent.time < 200 &&
    Math.abs(position - lastSent.position) < 0.22 &&
    paused === lastSent.paused
  ) {
    if (now - (lastSent.skipLog || 0) > 1200) {
      logOnce('⏳ emitAction SKIP: no changes');
      lastSent.skipLog = now;
    }
    return;
  }
  socket.emit('player_action', {
    roomId,
    position,
    is_paused: paused,
    speed: player.playbackRate
  });
  lastSent = { time: now, position, paused };
  logOnce(`[emitAction] ${paused ? 'pause' : 'play'} @${position.toFixed(3)}`);
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
