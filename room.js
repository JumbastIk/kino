// room.js
const API_BASE = window.location.origin.includes('localhost')
  ? 'http://localhost:3000'
  : 'https://kino-fhwp.onrender.com';
const socket   = io(API_BASE);

let videoEl;
let currentRoomId;
let currentUser;

// Отображает ошибку и прерывает дальнейшую инициализацию
function showError(msg) {
  document.body.innerHTML = `
    <p style="color:#f55; text-align:center; margin-top:50px;">
      ${msg}
    </p>`;
}

// Рендерит одно сообщение
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

// Применяет состояние плеера от сервера
function applyState({ position, is_paused }) {
  if (!videoEl) return;
  if (Math.abs(videoEl.currentTime - position) > 0.5) {
    videoEl.currentTime = position;
  }
  is_paused ? videoEl.pause() : videoEl.play();
}

// Шлёт своё текущее состояние на сервер
function sendState(is_paused) {
  socket.emit('player_action', {
    roomId: currentRoomId,
    position: videoEl.currentTime,
    is_paused
  });
}

// Шлёт новое сообщение
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

// Загружает историю чата через REST
async function loadHistory(roomId) {
  try {
    const res = await fetch(`${API_BASE}/api/messages/${roomId}`);
    if (!res.ok) throw new Error(res.statusText);
    return await res.json();
  } catch (e) {
    console.warn('Не удалось загрузить историю чата:', e);
    return [];
  }
}

// Достает прямую HLS-ссылку из embed-URL Bunny.net
async function fetchHlsUrl(embedUrl) {
  const parts   = embedUrl.split('/');
  const zone    = parts[4];
  const videoId = parts[5];
  // Добавляем .json, иначе 404
  const cfgUrl  = `https://iframe.mediadelivery.net/configuration/${zone}/${videoId}.json`;
  const res     = await fetch(cfgUrl);
  if (!res.ok) throw new Error('Не удалось загрузить конфигурацию видео');
  const cfg     = await res.json();
  // Bunny может класть поток под ключами hls или hls_url
  return cfg.hls || cfg.hls_url;
}

document.addEventListener('DOMContentLoaded', async () => {
  // 0) Инициализируем пользователя (Telegram WebApp или гость)
  if (window.Telegram?.WebApp) {
    Telegram.WebApp.ready();
    const tg = Telegram.WebApp.initDataUnsafe?.user || {};
    currentUser = {
      id:   tg.id       || 'guest',
      name: tg.first_name || tg.username || 'Guest'
    };
  } else {
    currentUser = { id: 'guest', name: 'Guest' };
  }

  // 1) Получаем roomId
  currentRoomId = new URLSearchParams(location.search).get('roomId');
  if (!currentRoomId) return showError('ID комнаты не указан.');

  // 2) Проверяем существование комнаты
  let rooms;
  try {
    rooms = await fetch(`${API_BASE}/api/rooms`).then(r => r.json());
  } catch {
    return showError('Не удалось загрузить список комнат.');
  }
  const room = rooms.find(r => r.id === currentRoomId);
  if (!room) return showError('Комната не найдена.');

  // 3) Ищем фильм по room.movie_id
  const movie = movies.find(m => m.id === room.movie_id);
  if (!movie) return showError('Фильм не найден.');

  // «Назад к описанию»
  document.getElementById('backLink').href =
    `movie.html?id=${encodeURIComponent(movie.id)}`;

  // 4) Получаем HLS-поток и создаём <video>
  let hlsUrl;
  try {
    hlsUrl = await fetchHlsUrl(movie.videoUrl);
  } catch (e) {
    return showError('Не удалось получить прямой поток видео.');
  }
  videoEl = document.createElement('video');
  videoEl.controls = true;
  videoEl.style.width = '100%';
  document.querySelector('.player-wrapper').innerHTML = '';
  document.querySelector('.player-wrapper').append(videoEl);

  // Подключаем HLS.js, если нужно
  if (Hls.isSupported()) {
    const hls = new Hls();
    hls.loadSource(hlsUrl);
    hls.attachMedia(videoEl);
  } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
    videoEl.src = hlsUrl;
  } else {
    return showError('Ваш браузер не поддерживает HLS-потоки.');
  }

  // 5) Загружаем историю чата и отрисовываем её
  const history = await loadHistory(currentRoomId);
  history.forEach(appendMessage);

  // 6) Подключаемся к Socket.IO
  socket.emit('join', { roomId: currentRoomId, userData: currentUser });
  socket.on('syncState', applyState);
  socket.on('play',       ({ position, is_paused }) => applyState({ position, is_paused }));
  socket.on('pause',      ({ position, is_paused }) => applyState({ position, is_paused }));
  socket.on('seek',       ({ position })           => applyState({ position, is_paused: videoEl.paused }));
  socket.on('chat_message', appendMessage);

  // 7) Слушаем локальные события плеера
  videoEl.addEventListener('play',  () => sendState(false));
  videoEl.addEventListener('pause', () => sendState(true));
  videoEl.addEventListener('seeked',() => sendState(videoEl.paused));

  // 8) Отправка чата
  document.getElementById('sendBtn').addEventListener('click', sendMessage);
  document.getElementById('chatInput').addEventListener('keyup', e => {
    if (e.key === 'Enter') sendMessage();
  });
});
