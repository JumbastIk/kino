// room.js
const API_BASE = window.location.origin.includes('localhost')
  ? 'http://localhost:3000'
  : 'https://kino-fhwp.onrender.com';

const socket = io(API_BASE);
let videoEl;
let currentRoomId;
let currentUser;

// Утилита для показа ошибки
function showError(msg) {
  document.body.innerHTML = `<p style="color:#f55; text-align:center; margin-top:50px;">${msg}</p>`;
}

// Добавляем одно сообщение в UI
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

// Применяем состояние плеера, полученное с сервера
function applyState({ position, is_paused }) {
  if (!videoEl) return;
  // только если существенное расхождение
  if (Math.abs(videoEl.currentTime - position) > 0.5) {
    videoEl.currentTime = position;
  }
  if (is_paused) videoEl.pause();
  else videoEl.play();
}

// Шлём собственное состояние (позиция + пауза)
function sendState(is_paused) {
  socket.emit('player_action', {
    roomId: currentRoomId,
    position: videoEl.currentTime,
    is_paused
  });
}

// Отправляем сообщение
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

// Загрузка истории чата
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
  // 0) Инициализируем Telegram WebApp (если нужно)
  if (window.Telegram && Telegram.WebApp) {
    Telegram.WebApp.ready();
    const tg = Telegram.WebApp.initDataUnsafe.user || {};
    currentUser = {
      id: tg.id || 'guest',
      name: tg.first_name || tg.username || 'Guest'
    };
  } else {
    // fallback
    currentUser = { id: 'guest', name: 'Guest' };
  }

  // 1) Получаем roomId из URL
  currentRoomId = new URLSearchParams(location.search).get('roomId');
  if (!currentRoomId) {
    return showError('ID комнаты не указан.');
  }

  // 2) Загрузим список комнат и найдём нужную
  let rooms;
  try {
    rooms = await fetch(`${API_BASE}/api/rooms`).then(r => r.json());
  } catch {
    return showError('Не удалось загрузить список комнат.');
  }
  const room = rooms.find(r => r.id === currentRoomId);
  if (!room) {
    return showError('Комната не найдена.');
  }

  // 3) Подключаем видео
  const movie = movies.find(m => m.id === room.movie_id);
  if (!movie) {
    return showError('Фильм не найден.');
  }
  const backLink = document.getElementById('backLink');
  backLink.href = `movie.html?id=${encodeURIComponent(movie.id)}`;
  videoEl = document.createElement('video');
  videoEl.src = movie.videoUrl;
  videoEl.controls = true;
  videoEl.style.width = '100%';
  document.querySelector('.player-wrapper').innerHTML = '';
  document.querySelector('.player-wrapper').append(videoEl);

  // 4) Загрузим историю чата и отрисуем
  const history = await loadHistory(currentRoomId);
  history.forEach(appendMessage);

  // 5) Подключаемся к Socket.IO
  socket.emit('join_room', { roomId: currentRoomId, user: currentUser });

  // 6) Слушаем события от сервера
  socket.on('room_members', members => {
    // TODO: отрисовать список участников
    console.log('Участники комнаты:', members);
  });
  socket.on('sync_state', applyState);
  socket.on('player_update', applyState);
  socket.on('new_message', appendMessage);

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