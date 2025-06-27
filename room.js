// ⚙️ Переменные и инициализация
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
let lastPing       = 0;
let myUserId       = null;
let initialSync    = null;
let syncTimeout    = null;
let metadataReady  = false;
let sendLock       = false;

// 🛠 Настройки синхронизации
function measurePing() {
  const t0 = Date.now();
  socket.emit('ping');
  socket.once('pong', () => {
    lastPing = Date.now() - t0;
    console.log('[PING]', lastPing, 'ms');
  });
}
setInterval(measurePing, 10000);

socket.on('connect', () => {
  myUserId = socket.id;
  socket.emit('join', { roomId, userData: { id: myUserId, first_name: 'Гость' } });
  socket.emit('request_state', { roomId });
  fetchRoom();
});
socket.on('reconnect', () => {
  socket.emit('request_state', { roomId });
});

// 📣 Чат и участники
socket.on('members', ms => {
  membersList.innerHTML =
    `<div class="chat-members-label">Участники (${ms.length}):</div>` +
    `<ul>${ms.map(m => `<li>${m.user_id}</li>`).join('')}</ul>`;
});
socket.on('history', data => {
  messagesBox.innerHTML = '';
  data.forEach(m => appendMessage(m.author, m.text));
});
socket.on('chat_message', m => appendMessage(m.author, m.text));
socket.on('system_message', msg => msg?.text && appendSystemMessage(msg.text));
sendBtn.addEventListener('click', sendMessage);
msgInput.addEventListener('keydown', e => { if (e.key === 'Enter') sendMessage(); });

function sendMessage() {
  const t = msgInput.value.trim();
  if (!t) return;
  socket.emit('chat_message', { roomId, author: 'Гость', text: t });
  msgInput.value = '';
}

// 🔄 Синхронизация
socket.on('sync_state', d => scheduleSync(d));
socket.on('player_update', d => scheduleSync(d));

function scheduleSync(d) {
  if (!metadataReady) {
    initialSync = d;
    return;
  }
  clearTimeout(syncTimeout);
  syncTimeout = setTimeout(() => doSync(d), 100);
}

function doSync({ position: pos, is_paused: isPaused, updatedAt: serverTs }) {
  if (!player || !metadataReady) return;

  const now = Date.now();
  const rtt = lastPing || 0;
  const drift = ((now - serverTs) / 1000) - (rtt / 2000);
  const targetTime = isPaused ? pos : pos + drift;
  const delta = targetTime - player.currentTime;
  const abs = Math.abs(delta);

  // Быстрая коррекция
  if (abs > 1.5) {
    player.currentTime = targetTime;
    console.log('✔ doSync → jump', targetTime.toFixed(2));
  } else if (!isPaused && abs > 0.1) {
    player.playbackRate = 1 + delta * 0.5;
    console.log('✔ doSync → rate', player.playbackRate.toFixed(2));
  } else {
    player.playbackRate = 1;
  }

  // Управление паузой
  if (isPaused && !player.paused) {
    player.pause();
    console.log('✔ doSync → pause');
  } else if (!isPaused && player.paused) {
    player.play().catch(() => {});
    console.log('✔ doSync → play');
  }

  setTimeout(() => {
    player.playbackRate = 1;
    isRemoteAction = false;
  }, 50);
}

// 📼 Инициализация видео
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
    v.addEventListener('play',   () => !isRemoteAction && emitAction(false));
    v.addEventListener('pause',  () => !isRemoteAction && emitAction(true));

    player = v;

  } catch (err) {
    console.error(err);
    playerWrapper.innerHTML = `<p class="error">Ошибка: ${err.message}</p>`;
  }
}

// 🛰 Действие плеера
function emitAction(paused) {
  if (sendLock || !player) return;
  socket.emit('player_action', {
    roomId,
    position: player.currentTime,
    is_paused: paused,
    speed: player.playbackRate
  });
  sendLock = true;
  setTimeout(() => sendLock = false, 100);
}

// 🔄 UI utils
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
