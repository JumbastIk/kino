// room.js
const API_BASE = window.location.origin.includes('localhost')
  ? 'http://localhost:3000'
  : 'https://kino-fhwp.onrender.com';

const socket = io(API_BASE);
let videoEl;
let currentRoomId;
let currentUser;

// Показать страницу ошибки
function showError(msg) {
  document.body.innerHTML = `<p style="color:#f55; text-align:center; margin-top:50px;">${msg}</p>`;
}

// Рендер одного сообщения в чат
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

// Рендер списка участников (если у вас есть <div id="membersList">)
function renderMembers(list) {
  const container = document.getElementById('membersList');
  if (!container) return;
  container.innerHTML = '';
  list.forEach(u => {
    const div = document.createElement('div');
    div.className = 'member';
    div.textContent = u.user_id;
    container.append(div);
  });
}

// Применить состояние плеера от сервера
function applyState({ position, is_paused }) {
  if (!videoEl) return;
  if (Math.abs(videoEl.currentTime - position) > 0.5) {
    videoEl.currentTime = position;
  }
  is_paused ? videoEl.pause() : videoEl.play();
}

// Отправить своё состояние на сервер
function sendState(is_paused) {
  socket.emit('player_action', {
    roomId: currentRoomId,
    position: videoEl.currentTime,
    is_paused
  });
}

// Отправить своё сообщение
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

// Подгрузить историю чата по API
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

// Утилита для получения HLS-URL из embed-ссылки Bunny.net
async function fetchHlsUrl(embedUrl) {
  const parts = embedUrl.split('/');
  const zone    = parts[4];
  const videoId = parts[5];
  const cfgUrl  = `https://iframe.mediadelivery.net/configuration/${zone}/${videoId}`;
  const res     = await fetch(cfgUrl);
  if (!res.ok) throw new Error('Не удалось загрузить конфигурацию видео');
  const cfg = await res.json();
  return cfg.hls || cfg.hls_url;
}

document.addEventListener('DOMContentLoaded', async () => {
  // 0) Инициализация Telegram WebApp (или гость)
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

  // 1) Получаем roomId из URL
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

  // 3) Ищем фильм по room.movie_id и бек «Назад»
  const movie = movies.find(m => m.id === room.movie_id);
  if (!movie) return showError('Фильм не найден.');
  document.getElementById('backLink').href =
    `movie.html?id=${encodeURIComponent(movie.id)}`;

  // 4) Получаем прямой HLS URL и монтируем <video>
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

  if (Hls.isSupported()) {
    const hls = new Hls();
    hls.loadSource(hlsUrl);
    hls.attachMedia(videoEl);
  } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
    videoEl.src = hlsUrl;
  } else {
    return showError('Ваш браузер не поддерживает HLS-потоки.');
  }

  // 5) Подгружаем историю чата
  const history = await loadHistory(currentRoomId);
  history.forEach(appendMessage);

  // 6) Подписываемся на Socket.IO
  socket.emit('join', { roomId: currentRoomId, userData: currentUser });
  socket.on('room_members', renderMembers);
  socket.on('syncState', applyState);
  socket.on('play',   ({ position, is_paused }) => applyState({ position, is_paused }));
  socket.on('pause',  ({ position, is_paused }) => applyState({ position, is_paused }));
  socket.on('seek',   ({ position, is_paused }) => applyState({ position, is_paused }));
  socket.on('chat_message', appendMessage);

  // 7) Локальные события плеера
  videoEl.addEventListener('play',  () => sendState(false));
  videoEl.addEventListener('pause', () => sendState(true));
  videoEl.addEventListener('seeked', () => sendState(videoEl.paused));

  // 8) Отправка чата
  document.getElementById('sendBtn').addEventListener('click', sendMessage);
  document.getElementById('chatInput').addEventListener('keyup', e => {
    if (e.key === 'Enter') sendMessage();
  });
});
