const socket = io();

// Получение параметров из URL
const params = new URLSearchParams(window.location.search);
const roomId = params.get('roomId');

if (!roomId) {
  alert('Не указан ID комнаты.');
  location.href = 'index.html';
}

const tg = window.Telegram.WebApp;
tg.expand();

// Получение данных пользователя Telegram
const user = tg.initDataUnsafe.user || {
  id: Date.now(),
  first_name: 'Гость'
};

const API_BASE = window.location.origin.includes('localhost')
  ? 'http://localhost:3000'
  : window.location.origin;

const playerWrapper = document.getElementById('playerWrapper');
const backLink = document.getElementById('backLink');
const msgInput = document.getElementById('msgInput');
const sendBtn = document.getElementById('sendBtn');
const messagesBox = document.getElementById('messages');
const membersList = document.getElementById('membersList');

// Подключение к комнате
socket.emit('join', {
  roomId,
  userData: user
});

// Запрос текущего состояния плеера
socket.emit('request_state', { roomId });

let player;
let isSeeking = false;

// Получение информации о комнате
async function fetchRoom() {
  try {
    const res = await fetch(`${API_BASE}/api/rooms/${roomId}`);
    const data = await res.json();
    const movie = movies.find(m => m.id === data.movie_id);
    if (!movie) throw new Error('Фильм не найден.');

    backLink.href = `movie.html?id=${movie.id}`;

    playerWrapper.innerHTML = `
      <video id="videoPlayer" class="video-player" controls></video>
    `;

    const video = document.getElementById('videoPlayer');

    if (Hls.isSupported()) {
      const hls = new Hls();
      hls.loadSource(movie.src);
      hls.attachMedia(video);
    } else {
      video.src = movie.src;
    }

    video.addEventListener('play', () => {
      if (!isSeeking) {
        socket.emit('player_action', {
          roomId,
          position: video.currentTime,
          is_paused: false
        });
      }
    });

    video.addEventListener('pause', () => {
      if (!isSeeking) {
        socket.emit('player_action', {
          roomId,
          position: video.currentTime,
          is_paused: true
        });
      }
    });

    video.addEventListener('seeking', () => {
      isSeeking = true;
    });

    video.addEventListener('seeked', () => {
      socket.emit('player_action', {
        roomId,
        position: video.currentTime,
        is_paused: video.paused
      });
      isSeeking = false;
    });

    player = video;
  } catch (err) {
    console.error('Ошибка загрузки комнаты:', err);
    playerWrapper.innerHTML = '<p class="error">Ошибка загрузки комнаты</p>';
  }
}

fetchRoom();

// Получение истории сообщений
socket.on('history', data => {
  messagesBox.innerHTML = '';
  data.forEach(({ author, text, created_at }) => {
    appendMessage(author, text, created_at);
  });
  messagesBox.scrollTop = messagesBox.scrollHeight;
});

// Получение новых сообщений
socket.on('chat_message', ({ author, text, created_at }) => {
  appendMessage(author, text, created_at);
});

// Обновление участников
socket.on('members', members => {
  membersList.innerHTML = `
    <div class="chat-members-label">Участники:</div>
    <ul>${members.map(id => `<li>${id}</li>`).join('')}</ul>
  `;
});

// Синхронизация плеера
socket.on('sync_state', ({ position, is_paused }) => {
  if (!player) return;
  player.currentTime = position;
  if (is_paused) {
    player.pause();
  } else {
    player.play();
  }
});

// Обновление состояния плеера от других
socket.on('player_update', ({ position, is_paused }) => {
  if (!player) return;
  isSeeking = true;
  player.currentTime = position;
  if (is_paused) {
    player.pause();
  } else {
    player.play();
  }
  setTimeout(() => (isSeeking = false), 500);
});

// Отправка сообщения
sendBtn.addEventListener('click', sendMessage);
msgInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') sendMessage();
});

function sendMessage() {
  const text = msgInput.value.trim();
  if (!text) return;
  socket.emit('chat_message', {
    roomId,
    author: user.first_name,
    text
  });
  msgInput.value = '';
}

function appendMessage(author, text, created_at) {
  const msg = document.createElement('div');
  msg.className = 'chat-message';
  msg.innerHTML = `<strong>${author}:</strong> ${text}`;
  messagesBox.appendChild(msg);
  messagesBox.scrollTop = messagesBox.scrollHeight;
}
