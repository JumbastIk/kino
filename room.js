// room.js

const BACKEND = window.location.hostname.includes('localhost')
  ? 'http://localhost:3000'
  : 'https://kino-fhwp.onrender.com';

const socket = io(BACKEND, {
  transports: ['websocket'],
  path: '/socket.io'
});

const params = new URLSearchParams(window.location.search);
const roomId = params.get('roomId');
if (!roomId) {
  alert('Не указан ID комнаты.');
  location.href = 'index.html';
}

const user = {
  id: Date.now().toString(),
  first_name: 'Гость'
};

const playerWrapper = document.getElementById('playerWrapper');
const backLink      = document.getElementById('backLink');
const msgInput      = document.getElementById('msgInput');
const sendBtn       = document.getElementById('sendBtn');
const messagesBox   = document.getElementById('messages');
const membersList   = document.getElementById('membersList');

let player;
let isSeeking = false;

// Сообщаем серверу о входе в комнату
socket.emit('join', { roomId, userData: user });
socket.emit('request_state', { roomId });

// Обработка списка участников
socket.on('members', members => {
  if (!Array.isArray(members)) return;
  const count = members.length;
  const items = members.map(m => `<li>${m.user_id}</li>`).join('');
  membersList.innerHTML = `
    <div class="chat-members-label">Участники (${count}):</div>
    <ul>${items}</ul>
  `;
});

// Чат
socket.on('history', data => {
  messagesBox.innerHTML = '';
  data.forEach(m => appendMessage(m.author, m.text));
});
socket.on('chat_message', m => appendMessage(m.author, m.text));

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

// Синхронизация состояния плеера при входе
socket.on('sync_state', ({ position = 0, is_paused }) => {
  if (!player) return;
  player.currentTime = position;
  if (is_paused) {
    player.pause();
  } else {
    player.play().catch(() => {});
  }
});

// Обновления плеера от других пользователей
socket.on('player_update', ({ position = 0, is_paused }) => {
  if (!player) return;
  isSeeking = true;
  player.currentTime = position;
  if (is_paused) {
    player.pause();
  } else {
    player.play().catch(() => {});
  }
  setTimeout(() => isSeeking = false, 200);
});

// Загрузка данных комнаты и инициализация плеера
async function fetchRoom() {
  try {
    const res = await fetch(`${BACKEND}/api/rooms/${roomId}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const roomData = await res.json();
    if (!roomData) throw new Error('Комната не найдена');

    const movie = movies.find(m => m.id === roomData.movie_id);
    if (!movie || !movie.videoUrl) throw new Error('Фильм не найден');

    backLink.href = `movie.html?id=${movie.id}`;

    playerWrapper.innerHTML = `
      <video id="videoPlayer" class="video-player" controls crossorigin="anonymous" playsinline></video>
      <button id="playBtn" class="play-btn">▶ Воспроизвести</button>
    `;

    const video   = document.getElementById('videoPlayer');
    const playBtn = document.getElementById('playBtn');

    playBtn.addEventListener('click', () => {
      video.play()
        .then(() => playBtn.style.display = 'none')
        .catch(() => {});
    });

    // Всегда HLS.js
    if (Hls.isSupported()) {
      const hls = new Hls({ debug: false });
      hls.loadSource(movie.videoUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.ERROR, (evt, data) => {
        console.error('[HLS] Ошибка:', data);
        alert(
          'Ошибка загрузки видео.\n' +
          'Проверьте настройки CDN и CORS для домена:\n' +
          window.location.origin
        );
      });
    } else {
      throw new Error('Ваш браузер не поддерживает HLS');
    }

    // Слушатели событий плеера
    video.addEventListener('play', () => {
      if (!isSeeking) {
        socket.emit('player_action', {
          roomId,
          position:  video.currentTime,
          is_paused: false
        });
      }
    });

    video.addEventListener('pause', () => {
      if (!isSeeking) {
        socket.emit('player_action', {
          roomId,
          position:  video.currentTime,
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
        position:  video.currentTime,
        is_paused: video.paused
      });
      setTimeout(() => isSeeking = false, 200);
    });

    player = video;
  } catch (err) {
    console.error('[ERROR] Ошибка комнаты:', err);
    playerWrapper.innerHTML = `<p class="error">Ошибка: ${err.message}</p>`;
  }
}

fetchRoom();

function appendMessage(author, text) {
  const div = document.createElement('div');
  div.className = 'chat-message';
  div.innerHTML = `<strong>${author}:</strong> ${text}`;
  messagesBox.appendChild(div);
  messagesBox.scrollTop = messagesBox.scrollHeight;
}
