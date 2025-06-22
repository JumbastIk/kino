// room.js (v=1.0)
const socket = io();

// Получение параметров из URL
const params = new URLSearchParams(window.location.search);
const roomId = params.get('roomId');
if (!roomId) {
  alert('Не указан ID комнаты.');
  location.href = 'index.html';
}

// Telegram WebApp (если используется внутри Telegram)
const tg = window.Telegram?.WebApp;
if (tg) tg.expand();

// Получение данных пользователя Telegram
const user = (tg?.initDataUnsafe?.user) || {
  id: Date.now(),
  first_name: 'Гость'
};

// Базовый API URL
const API_BASE = window.location.origin.includes('localhost')
  ? 'http://localhost:3000'
  : window.location.origin;

// Получаем DOM-элементы
const playerWrapper = document.getElementById('playerWrapper');
const backLink = document.getElementById('backLink');
const msgInput = document.getElementById('msgInput');
const sendBtn = document.getElementById('sendBtn');
const messagesBox = document.getElementById('messages');
const membersList = document.getElementById('membersList');

let player;
let isSeeking = false;

// Подключаемся к комнате
socket.emit('join', { roomId, userData: user });
socket.emit('request_state', { roomId });

// Получаем комнату, фильм, и инициализируем плеер
async function fetchRoom() {
  try {
    const res = await fetch(`${API_BASE}/api/rooms/${roomId}`);
    const data = await res.json();
    if (!data) throw new Error('Комната не найдена');
    const movie = movies.find(m => m.id === data.movie_id);
    if (!movie || !movie.videoUrl) throw new Error('Фильм не найден');

    backLink.href = `movie.html?id=${movie.id}`;

    // Вставляем плеер
    playerWrapper.innerHTML = `<video id="videoPlayer" class="video-player" controls></video>`;
    const video = document.getElementById('videoPlayer');

    // Подключаем HLS.js
    if (Hls.isSupported()) {
      const hls = new Hls();
      hls.loadSource(movie.videoUrl);
      hls.attachMedia(video);
    } else {
      video.src = movie.videoUrl;
    }

    // Отправка действий пользователем
    video.addEventListener('play', () => {
      if (!isSeeking) socket.emit('player_action', {
        roomId,
        position: video.currentTime,
        is_paused: false
      });
    });

    video.addEventListener('pause', () => {
      if (!isSeeking) socket.emit('player_action', {
        roomId,
        position: video.currentTime,
        is_paused: true
      });
    });

    video.addEventListener('seeking', () => { isSeeking = true; });
    video.addEventListener('seeked', () => {
      socket.emit('player_action', {
        roomId,
        position: video.currentTime,
        is_paused: video.paused
      });
      setTimeout(() => (isSeeking = false), 200);
    });

    player = video;
  } catch (err) {
    console.error('Ошибка загрузки комнаты:', err);
    playerWrapper.innerHTML = '<p class="error">Ошибка загрузки комнаты</p>';
  }
}
fetchRoom();

// Chat: вывод истории и новых сообщений
socket.on('history', data => {
  messagesBox.innerHTML = '';
  data.forEach(m => appendMessage(m.author, m.text));
});
socket.on('chat_message', m => appendMessage(m.author, m.text));

// Chat: отправка
sendBtn.addEventListener('click', sendMessage);
msgInput.addEventListener('keydown', e => e.key === 'Enter' && sendMessage());

function sendMessage() {
  const text = msgInput.value.trim();
  if (!text) return;
  socket.emit('chat_message', { roomId, author: user.first_name, text });
  msgInput.value = '';
}

// Слушатели плеера
socket.on('sync_state', state => {
  if (!player) return;
  player.currentTime = state.position || 0;
  state.is_paused ? player.pause() : player.play();
});
socket.on('player_update', state => {
  if (!player) return;
  isSeeking = true;
  player.currentTime = state.position || 0;
  state.is_paused ? player.pause() : player.play();
  setTimeout(() => (isSeeking = false), 200);
});

// Участники
socket.on('members', members => {
  membersList.innerHTML = `<div class="chat-members-label">Участники:</div>
    <ul>${members.map(id => `<li>${id}</li>`).join('')}</ul>`;
});

// Добавление сообщения в окно
function appendMessage(author, text) {
  const div = document.createElement('div');
  div.className = 'chat-message';
  div.innerHTML = `<strong>${author}:</strong> ${text}`;
  messagesBox.appendChild(div);
  messagesBox.scrollTop = messagesBox.scrollHeight;
}
