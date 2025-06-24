// room.js?v=2.0.10000002

const BACKEND = (location.hostname.includes('localhost'))
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

let player, isSeeking = false, isRemoteAction = false;
let lastUpdate = 0;
let ownerId = null;
let iAmOwner = false;
let myUserId = socket.id; // по умолчанию, инициализируется после join

// === Участники комнаты ===
socket.on('members', members => {
  membersList.innerHTML =
    `<div class="chat-members-label">Участники (${members.length}):</div>
    <ul>${members.map(m => `<li>${m.user_id}</li>`).join('')}</ul>`;
});

// =========== Чат ===========
socket.emit('join', { roomId, userData: { id: myUserId, first_name: 'Гость' } });
socket.emit('request_state', { roomId });

socket.on('history', data => {
  messagesBox.innerHTML = '';
  data.forEach(m => appendMessage(m.author, m.text));
});
socket.on('chat_message', m => appendMessage(m.author, m.text));
socket.on('system_message', msg => {
  if (msg && msg.text) appendSystemMessage(msg.text);
});

sendBtn.addEventListener('click', sendMessage);
msgInput.addEventListener('keydown', e => e.key === 'Enter' && sendMessage());
function sendMessage() {
  const text = msgInput.value.trim();
  if (!text) return;
  socket.emit('chat_message', { roomId, author: 'Гость', text });
  msgInput.value = '';
}

// =========== Плеер и только у owner управление ===========

function updateOwnerState(newOwnerId) {
  // Главное: если owner_id отсутствует — делаем owner себя!
  if (newOwnerId) {
    ownerId = newOwnerId;
  } else if (!ownerId) {
    ownerId = myUserId;
  }
  iAmOwner = (myUserId === ownerId);
}

socket.on('sync_state', ({ position = 0, is_paused, updatedAt = 0, owner_id }) => {
  updateOwnerState(owner_id);
  if (updatedAt < lastUpdate) return;
  lastUpdate = updatedAt;
  if (!player) return;
  isRemoteAction = true;
  player.currentTime = position;
  is_paused ? player.pause() : player.play().catch(() => {});
  setTimeout(() => isRemoteAction = false, 200);
});
socket.on('player_update', ({ position = 0, is_paused, updatedAt = 0, owner_id }) => {
  updateOwnerState(owner_id);
  if (updatedAt < lastUpdate) return;
  lastUpdate = updatedAt;
  if (!player) return;
  isRemoteAction = true;
  isSeeking = true;
  player.currentTime = position;
  is_paused ? player.pause() : player.play().catch(() => {});
  setTimeout(() => {
    isSeeking = false;
    isRemoteAction = false;
  }, 200);
});

async function fetchRoom() {
  try {
    const res = await fetch(`${BACKEND}/api/rooms/${roomId}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const roomData = await res.json();

    // Главное: корректно назначаем ownerId
    updateOwnerState(roomData.owner_id);

    const movie = movies.find(m => m.id === roomData.movie_id);
    if (!movie || !movie.videoUrl) throw new Error('Фильм не найден');
    backLink.href = `${movie.html}?id=${movie.id}`;

    playerWrapper.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.style.position = 'relative';
    wrap.innerHTML =
      `<video id="videoPlayer" controls crossorigin="anonymous" playsinline
             style="width:100%;border-radius:14px"></video>`;
    const spinner = createSpinner();
    wrap.appendChild(spinner);
    playerWrapper.appendChild(wrap);

    const badge = document.createElement('div');
    badge.className = 'room-id-badge';
    badge.innerHTML =
      `<small>ID комнаты:</small>
      <code>${roomId}</code>
      <button id="copyRoomId">Копировать</button>`;
    playerWrapper.after(badge);
    document.getElementById('copyRoomId').onclick = () => {
      navigator.clipboard.writeText(roomId);
      alert('ID комнаты скопирован');
    };

    const v = document.getElementById('videoPlayer');
    if (typeof Hls !== 'undefined' && Hls.isSupported()) {
      const hls = new Hls({ debug: false });
      hls.loadSource(movie.videoUrl);
      hls.attachMedia(v);
      hls.on(Hls.Events.ERROR, (_, data) => {
        console.error('[HLS] Ошибка:', data);
        alert('Ошибка загрузки видео');
      });
      v.addEventListener('waiting', () => spinner.style.display = 'block');
      v.addEventListener('playing', () => spinner.style.display = 'none');
    } else if (v.canPlayType('application/vnd.apple.mpegurl')) {
      v.src = movie.videoUrl;
    } else {
      throw new Error('Ваш браузер не поддерживает HLS');
    }

    // --- Только owner управляет видео ---
    if (iAmOwner) {
      v.addEventListener('play', () => {
        if (isSeeking || isRemoteAction) return;
        socket.emit('player_action', {
          roomId,
          position: v.currentTime,
          is_paused: false,
          updatedAt: Date.now(),
          userId: myUserId
        });
      });
      v.addEventListener('pause', () => {
        if (isSeeking || isRemoteAction) return;
        socket.emit('player_action', {
          roomId,
          position: v.currentTime,
          is_paused: true,
          updatedAt: Date.now(),
          userId: myUserId
        });
      });
      v.addEventListener('seeking', () => { isSeeking = true; });
      v.addEventListener('seeked', () => {
        if (!isRemoteAction) {
          socket.emit('player_action', {
            roomId,
            position: v.currentTime,
            is_paused: v.paused,
            updatedAt: Date.now(),
            userId: myUserId
          });
        }
        setTimeout(() => isSeeking = false, 200);
      });
    } else {
      // --- Не owner — блокируем управление плеером ---
      v.controls = false;
      v.addEventListener('play', e => { if (!isRemoteAction) v.pause(); });
      v.addEventListener('seeking', e => { if (!isRemoteAction) v.currentTime = v.currentTime; });
    }

    player = v;

  } catch (err) {
    console.error('[ERROR] Ошибка комнаты:', err);
    playerWrapper.innerHTML = `<p class="error">Ошибка: ${err.message}</p>`;
  }
}

fetchRoom();

function createSpinner() {
  const s = document.createElement('div');
  s.className = 'buffer-spinner';
  s.innerHTML =
    `<div class="double-bounce1"></div>
    <div class="double-bounce2"></div>`;
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
