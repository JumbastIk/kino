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

// 1) Измеряем RTT
function measurePing() {
  try {
    const t0 = Date.now();
    socket.emit('ping');
    socket.once('pong', () => {
      lastPing = Date.now() - t0;
    });
  } catch (err) {
    console.error('Ping error', err);
  }
}
setInterval(measurePing, 10_000);

// 2) Троттлим отправку действий и запоминаем время локального события
function emitPlayerActionThrottled(isPaused) {
  if (sendLock || !player) return;
  lastLocalAction = Date.now();
  try {
    socket.emit('player_action', {
      roomId,
      position:  player.currentTime,
      is_paused: isPaused,
      speed:     player.playbackRate
    });
  } catch (err) {
    console.error('Emit action error', err);
  }
  sendLock = true;
  setTimeout(() => sendLock = false, 150);
}

// 3) Обработка базовых socket-событий
socket.on('connect', () => {
  myUserId = socket.id;
  socket.emit('join',     { roomId, userData: { id: myUserId, first_name: 'Гость' } });
  socket.emit('request_state', { roomId });
  fetchRoom();
});

socket.on('members', ms => {
  try {
    membersList.innerHTML =
      `<div class="chat-members-label">Участники (${ms.length}):</div>
       <ul>${ms.map(m=>`<li>${m.user_id}</li>`).join('')}</ul>`;
  } catch (err) {
    console.error('Members render error', err);
  }
});

socket.on('history', data => {
  try {
    messagesBox.innerHTML = '';
    data.forEach(m => appendMessage(m.author, m.text));
  } catch (err) {
    console.error('History render error', err);
  }
});

socket.on('chat_message', m => {
  try { appendMessage(m.author, m.text); }
  catch (err) { console.error('Chat message render error', err); }
});

socket.on('system_message', msg => {
  if (msg?.text) {
    try { appendSystemMessage(msg.text); }
    catch (err) { console.error('System message error', err); }
  }
});

socket.on('pong', () => {});  // нужно для measurePing

// при ошибке соединения – пробуем восстановить
socket.on('error', err => {
  console.error('Socket error', err);
  setTimeout(() => socket.emit('request_state', { roomId }), 1000);
});

// 4) Синхронизация с учётом пинга, прогноза и локальных действий
function debouncedSync(pos, isPaused, serverTs) {
  if (syncTimeout) clearTimeout(syncTimeout);
  syncTimeout = setTimeout(() => {
    try {
      doSync(pos, isPaused, serverTs);
    } catch (err) {
      console.error('Sync error', err);
      socket.emit('request_state', { roomId });
    }
  }, 50);
}

function doSync(pos, isPaused, serverTs) {
  // Игнорируем «эхо» сразу после нашего действия
  if (serverTs <= lastLocalAction + 500) return;
  // Игнорируем старые обновления
  if (serverTs < lastUpdate) return;
  lastUpdate = serverTs;
  if (!player) return;

  isRemoteAction = true;

  // Прогнозируем позицию
  const now     = Date.now();
  const drift  = (now - serverTs) - lastPing / 2;
  const target = isPaused
    ? pos
    : pos + drift / 1000;

  const delta    = target - player.currentTime;
  const absDelta = Math.abs(delta);

  // Жесткий seek
  if (absDelta > 1) {
    player.currentTime = target;
  }
  // Мягкая подгонка скорости
  else if (absDelta > 0.05) {
    player.playbackRate = delta > 0 ? 1.05 : 0.95;
    setTimeout(() => {
      if (player) player.playbackRate = 1;
    }, 500);
  }

  // Пауза/плей: не занижаем в паузу, если локально идёт воспроизведение после seek
  if (isPaused) {
    if (!player.paused) player.pause();
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

// 5) Инициализация плеера с привязкой throttled-emit
async function fetchRoom() {
  try {
    const res = await fetch(`${BACKEND}/api/rooms/${roomId}`);
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const roomData = await res.json();

    const movie = movies.find(m => m.id === roomData.movie_id);
    if (!movie?.videoUrl) throw new Error('Фильм не найден');
    backLink.href = `${movie.html}?id=${movie.id}`;

    playerWrapper.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.style.position = 'relative';
    wrap.innerHTML = `
      <video id="videoPlayer" controls crossorigin="anonymous" playsinline
             style="width:100%;border-radius:14px"></video>`;
    const spinner = createSpinner();
    wrap.appendChild(spinner);
    playerWrapper.appendChild(wrap);

    const badge = document.createElement('div');
    badge.className = 'room-id-badge';
    badge.innerHTML = `
      <small>ID комнаты:</small>
      <code>${roomId}</code>
      <button id="copyRoomId">Копировать</button>`;
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
      v.addEventListener('waiting', () => spinner.style.display = 'block');
      v.addEventListener('playing', () => spinner.style.display = 'none');
    } else if (v.canPlayType('application/vnd.apple.mpegurl')) {
      v.src = movie.videoUrl;
    } else {
      throw new Error('HLS не поддерживается');
    }

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

    v.addEventListener('play',   () => { if (!isRemoteAction) emitPlayerActionThrottled(false); });
    v.addEventListener('pause',  () => { if (!isRemoteAction) emitPlayerActionThrottled(true); });
    v.addEventListener('seeked', () => { if (!isRemoteAction) emitPlayerActionThrottled(v.paused); });

    player = v;

  } catch (err) {
    console.error('FetchRoom error', err);
    playerWrapper.innerHTML = `<p class="error">Ошибка: ${err.message}</p>`;
  }
}

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
