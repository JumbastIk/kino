const API_BASE = window.location.origin.includes('localhost')
  ? 'http://localhost:3000'
  : 'https://kino-fhwp.onrender.com';
const socket = io(API_BASE);

let videoEl, currentRoomId, currentUser;

function showError(msg) {
  document.body.innerHTML = `
    <p style="color:#f55; text-align:center; margin-top:50px;">
      ${msg}
    </p>`;
}

function appendMessage({ author, text, created_at }) {
  const box = document.getElementById('chatMessages');
  const div = document.createElement('div');
  div.className = 'chat-message';
  div.innerHTML = `
    <span class="author">${author}</span>:
    <span class="text">${text}</span>
    <span class="timestamp">${new Date(created_at).toLocaleTimeString()}</span>
  `;
  box.append(div);
  box.scrollTop = box.scrollHeight;
}

function applyState({ position, is_paused }) {
  if (!videoEl) return;
  if (Math.abs(videoEl.currentTime - position) > 0.5) {
    videoEl.currentTime = position;
  }
  is_paused ? videoEl.pause() : videoEl.play();
}

function sendState(is_paused) {
  socket.emit('player_action', {
    roomId: currentRoomId,
    position: videoEl.currentTime,
    is_paused
  });
}

function sendMessage() {
  const input = document.getElementById('chatInput');
  const text = input.value.trim();
  if (!text) return;
  socket.emit('chat_message', {
    roomId: currentRoomId,
    author: currentUser.name,
    text
  });
  input.value = '';
}

async function loadHistory(roomId) {
  try {
    const res = await fetch(`${API_BASE}/api/messages/${roomId}`);
    if (!res.ok) throw new Error(res.statusText);
    return await res.json();
  } catch (e) {
    console.warn('Историю чата загрузить не удалось:', e);
    return [];
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  if (window.Telegram?.WebApp) {
    Telegram.WebApp.ready();
    const tg = Telegram.WebApp.initDataUnsafe?.user || {};
    currentUser = {
      id: tg.id || 'guest',
      name: tg.first_name || tg.username || 'Guest'
    };
  } else {
    currentUser = { id: 'guest', name: 'Guest' };
  }

  currentRoomId = new URLSearchParams(location.search).get('roomId');
  if (!currentRoomId) return showError('ID комнаты не указан.');

  let rooms;
  try {
    rooms = await fetch(`${API_BASE}/api/rooms`).then(r => r.json());
  } catch {
    return showError('Не удалось получить список комнат.');
  }

  const room = rooms.find(r => r.id === currentRoomId);
  if (!room) return showError('Комната не существует.');

  const movie = movies.find(m => m.id === room.movie_id);
  if (!movie) return showError('Фильм не найден.');

  document.getElementById('backLink').href =
    `movie.html?id=${encodeURIComponent(movie.id)}`;

  // Используем videoUrl напрямую, так как это .m3u8
  const hlsUrl = movie.videoUrl;

  videoEl = document.createElement('video');
  videoEl.controls = true;
  videoEl.style.width = '100%';
  const wrapper = document.querySelector('.player-wrapper');
  wrapper.innerHTML = '';
  wrapper.append(videoEl);

  if (Hls.isSupported()) {
    const hls = new Hls();
    hls.loadSource(hlsUrl);
    hls.attachMedia(videoEl);
  } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
    videoEl.src = hlsUrl;
  } else {
    return showError('Ваш браузер не поддерживает HLS-потоки.');
  }

  (await loadHistory(currentRoomId)).forEach(appendMessage);

  socket.emit('join', { roomId: currentRoomId, userData: currentUser });
  socket.on('sync_state', applyState);
  socket.on('player_update', applyState);
  socket.on('chat_message', appendMessage);

  videoEl.addEventListener('play', () => sendState(false));
  videoEl.addEventListener('pause', () => sendState(true));
  videoEl.addEventListener('seeked', () => sendState(videoEl.paused));

  document.getElementById('sendBtn').addEventListener('click', sendMessage);
  document.getElementById('chatInput').addEventListener('keyup', e => {
    if (e.key === 'Enter') sendMessage();
  });
});
