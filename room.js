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

// Рендер списка участников
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
  if (is_paused) videoEl.pause();
  else videoEl.play();
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

document.addEventListener('DOMContentLoaded', async () => {
  // Telegram WebApp
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

  // Получаем roomId
  currentRoomId = new URLSearchParams(location.search).get('roomId');
  if (!currentRoomId) return showError('ID комнаты не указан.');

  // Проверяем, что такая комната есть
  let rooms;
  try {
    rooms = await fetch(`${API_BASE}/api/rooms`).then(r => r.json());
  } catch {
    return showError('Не удалось загрузить список комнат.');
  }
  const room = rooms.find(r => r.id === currentRoomId);
  if (!room) return showError('Комната не найдена.');

  // Находим фильм и показываем кнопку «Назад»
  const movie = movies.find(m => m.id === room.movie_id);
  if (!movie) return showError('Фильм не найден.');
  document.getElementById('backLink').href =
    `movie.html?id=${encodeURIComponent(movie.id)}`;

  // Вставляем video-элемент
  videoEl = document.createElement('video');
  videoEl.src = movie.videoUrl;
  videoEl.controls = true;
  videoEl.style.width = '100%';
  const player = document.querySelector('.player-wrapper');
  player.innerHTML = '';
  player.append(videoEl);

  // Подгружаем и отрисовываем историю чата
  const history = await loadHistory(currentRoomId);
  history.forEach(appendMessage);

  // Подписываемся на Socket.IO
  socket.emit('join', { roomId: currentRoomId, userData: currentUser });

  socket.on('room_members', renderMembers);
  socket.on('syncState', applyState);
  socket.on('player_action', applyState);
  socket.on('new_message', appendMessage);

  // Локальные события плеера
  videoEl.addEventListener('play', () => sendState(false));
  videoEl.addEventListener('pause', () => sendState(true));
  videoEl.addEventListener('seeked', () => sendState(videoEl.paused));

  // Отправка чата
  document.getElementById('sendBtn').addEventListener('click', sendMessage);
  document.getElementById('chatInput').addEventListener('keyup', e => {
    if (e.key === 'Enter') sendMessage();
  });
});
