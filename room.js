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
let isRemoteAction = false;
let lastUpdate = 0;
let myUserId = null;
let initialSync = null;
let syncTimeout = null;

// Отправка действий любого пользователя
function emitPlayerAction(isPaused) {
  socket.emit('player_action', {
    roomId,
    position:  player.currentTime,
    is_paused: isPaused,
    speed:     player.playbackRate,
    updatedAt: Date.now(),
    userId:    myUserId
  });
}

// Подключаемся, получаем свой socket.id и запрашиваем состояние
socket.on('connect', () => {
  myUserId = socket.id;
  socket.emit('join', { roomId, userData: { id: myUserId, first_name: 'Гость' } });
  socket.emit('request_state', { roomId });
  fetchRoom();
});

// Чат и список участников
socket.on('members', ms => {
  membersList.innerHTML =
    `<div class="chat-members-label">Участники (${ms.length}):</div>
     <ul>${ms.map(m=>`<li>${m.user_id}</li>`).join('')}</ul>`;
});
socket.on('history', data => {
  messagesBox.innerHTML = '';
  data.forEach(m=>appendMessage(m.author, m.text));
});
socket.on('chat_message', m => appendMessage(m.author, m.text));
socket.on('system_message', msg => msg?.text && appendSystemMessage(msg.text));

sendBtn.addEventListener('click', sendMessage);
msgInput.addEventListener('keydown', e => e.key === 'Enter' && sendMessage());
function sendMessage() {
  const t = msgInput.value.trim();
  if (!t) return;
  socket.emit('chat_message', { roomId, author: 'Гость', text: t });
  msgInput.value = '';
}

// Синхронизация с учётом задержек
function debouncedSync(pos, isPaused, timestamp) {
  if (syncTimeout) clearTimeout(syncTimeout);
  syncTimeout = setTimeout(() => {
    doSync(pos, isPaused, timestamp);
  }, 100);
}

function doSync(pos, isPaused, timestamp) {
  if (timestamp < lastUpdate) return;
  lastUpdate = timestamp;
  if (!player) return;

  isRemoteAction = true;

  // корректируем позицию, если слишком далеко
  if (Math.abs(player.currentTime - pos) > 0.7 && player.readyState > 0) {
    player.currentTime = pos;
  }

  // пауза/воспроизведение
  if (isPaused && !player.paused) {
    player.pause();
  } else if (!isPaused && player.paused) {
    player.play().catch(() => {
      if (!window.__autoplayWarned) {
        window.__autoplayWarned = true;
        alert('Нажмите по видео для автозапуска');
      }
    });
  }

  // снимаем флаг через короткое время
  setTimeout(() => isRemoteAction = false, 120);
}

socket.on('sync_state', d => {
  if (!player) {
    initialSync = d;
  } else {
    debouncedSync(d.position, d.is_paused, d.updatedAt);
  }
});
socket.on('player_update', d => {
  debouncedSync(d.position, d.is_paused, d.updatedAt);
});

// Инициализация плеера
async function fetchRoom() {
  try {
    const res = await fetch(`${BACKEND}/api/rooms/${roomId}`);
    if (!res.ok) throw new Error(res.status);
    const roomData = await res.json();

    const movie = movies.find(m => m.id === roomData.movie_id);
    if (!movie?.videoUrl) throw new Error('Фильм не найден');
    backLink.href = `${movie.html}?id=${movie.id}`;

    // создаём контейнер для видео + спиннер
    playerWrapper.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.style.position = 'relative';
    wrap.innerHTML = `
      <video id="videoPlayer" controls crossorigin="anonymous" playsinline
             style="width:100%;border-radius:14px"></video>
    `;
    const spinner = createSpinner();
    wrap.appendChild(spinner);
    playerWrapper.appendChild(wrap);

    // бейдж с ID комнаты
    const badge = document.createElement('div');
    badge.className = 'room-id-badge';
    badge.innerHTML = `
      <small>ID комнаты:</small>
      <code>${roomId}</code>
      <button id="copyRoomId">Копировать</button>
    `;
    playerWrapper.after(badge);
    document.getElementById('copyRoomId').onclick = () => {
      navigator.clipboard.writeText(roomId);
      alert('Скопировано');
    };

    // подключаем HLS или нативный плеер
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

    // вещаем собственные события play/pause/seek
    v.addEventListener('play', () => {
      if (!isRemoteAction) emitPlayerAction(false);
    });
    v.addEventListener('pause', () => {
      if (!isRemoteAction) emitPlayerAction(true);
    });
    v.addEventListener('seeked', () => {
      if (!isRemoteAction) emitPlayerAction(v.paused);
    });

    player = v;

  } catch (err) {
    console.error(err);
    playerWrapper.innerHTML = `<p class="error">Ошибка: ${err.message}</p>`;
  }
}

// спиннер загрузки
function createSpinner() {
  const s = document.createElement('div');
  s.className = 'buffer-spinner';
  s.innerHTML = `<div class="double-bounce1"></div><div class="double-bounce2"></div>`;
  s.style.display = 'none';
  return s;
}

// чатовые сообщения
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
