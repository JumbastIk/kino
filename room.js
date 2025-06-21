// room.js
const API_BASE = window.location.origin.includes('localhost')
  ? 'http://localhost:3000'
  : 'https://kino-fhwp.onrender.com';
const socket   = io(API_BASE);

let videoEl, currentRoomId, currentUser;

// Показываем ошибку и прекращаем всю инициализацию
function showError(msg) {
  document.body.innerHTML = `
    <p style="color:#f55; text-align:center; margin-top:50px;">
      ${msg}
    </p>`;
}

// Рендер одного сообщения
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

// Применяем состояние плеера от сервера
function applyState({ position, is_paused }) {
  if (!videoEl) return;
  // только если расхождение > 0.5 с
  if (Math.abs(videoEl.currentTime - position) > 0.5) {
    videoEl.currentTime = position;
  }
  is_paused ? videoEl.pause() : videoEl.play();
}

// Шлём своё состояние (позиция + пауза)
function sendState(is_paused) {
  socket.emit('player_action', {
    roomId: currentRoomId,
    position: videoEl.currentTime,
    is_paused
  });
}

// Шлём чат-сообщение
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

// Загружаем историю чата
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

// Получаем прямой HLS-поток из embed-URL
async function fetchHlsUrl(embedUrl) {
  const parts   = embedUrl.split('/');
  const zone    = parts[4];
  const videoId = parts[5];
  // ТУТ УБИРАЕМ .json
  const cfgUrl  = `https://iframe.mediadelivery.net/configuration/${zone}/${videoId}`;
  const res     = await fetch(cfgUrl);
  if (!res.ok) throw new Error(`Конфиг не найден: ${res.status}`);
  const cfg     = await res.json();
  return cfg.hls || cfg.hls_url;
}

document.addEventListener('DOMContentLoaded', async () => {
  // 0) Телеграм-юзер или гость
  if (window.Telegram?.WebApp) {
    Telegram.WebApp.ready();
    const tg = Telegram.WebApp.initDataUnsafe?.user || {};
    currentUser = {
      id:   tg.id   || 'guest',
      name: tg.first_name || tg.username || 'Guest'
    };
  } else {
    currentUser = { id: 'guest', name: 'Guest' };
  }

  // 1) roomId из URL
  currentRoomId = new URLSearchParams(location.search).get('roomId');
  if (!currentRoomId) return showError('ID комнаты не указан.');

  // 2) подгружаем список комнат и находим нужную
  let rooms;
  try {
    rooms = await fetch(`${API_BASE}/api/rooms`).then(r => r.json());
  } catch {
    return showError('Не удалось получить список комнат.');
  }
  const room = rooms.find(r => r.id === currentRoomId);
  if (!room) return showError('Комната не существует.');

  // 3) находим фильм по room.movie_id
  const movie = movies.find(m => m.id === room.movie_id);
  if (!movie) return showError('Фильм не найден.');

  // назад
  document.getElementById('backLink').href =
    `movie.html?id=${encodeURIComponent(movie.id)}`;

  // 4) получаем HLS и создаём video
  let hlsUrl;
  try {
    hlsUrl = await fetchHlsUrl(movie.videoUrl);
  } catch (e) {
    console.error(e);
    return showError('Не удалось получить прямой поток видео.');
  }
  videoEl = document.createElement('video');
  videoEl.controls = true;
  videoEl.style.width = '100%';
  const wrapper = document.querySelector('.player-wrapper');
  wrapper.innerHTML = '';
  wrapper.append(videoEl);

  // подключаем HLS.js
  if (Hls.isSupported()) {
    const hls = new Hls();
    hls.loadSource(hlsUrl);
    hls.attachMedia(videoEl);
  } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
    videoEl.src = hlsUrl;
  } else {
    return showError('Ваш браузер не поддерживает HLS-потоки.');
  }

  // 5) история чата
  (await loadHistory(currentRoomId)).forEach(appendMessage);

  // 6) Socket.IO
  socket.emit('join', { roomId: currentRoomId, userData: currentUser });
  socket.on('syncState', applyState);
  socket.on('play',       applyState);
  socket.on('pause',      applyState);
  socket.on('seek',       applyState);
  socket.on('chat_message', appendMessage);

  // 7) слушаем плейер
  videoEl.addEventListener('play',  () => sendState(false));
  videoEl.addEventListener('pause', () => sendState(true));
  videoEl.addEventListener('seeked',() => sendState(videoEl.paused));

  // 8) отправка чата
  document.getElementById('sendBtn').addEventListener('click', sendMessage);
  document.getElementById('chatInput').addEventListener('keyup', e => {
    if (e.key === 'Enter') sendMessage();
  });
});
