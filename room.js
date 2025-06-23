// room.js

// ————— Настройка бэкенда и Socket.IO —————
const BACKEND = window.location.hostname.includes('localhost')
  ? 'http://localhost:3000'
  : 'https://kino-fhwp.onrender.com';

const socket = io(BACKEND, {
  path: '/socket.io',
  transports: ['websocket']
});

// ————— Получаем ID комнаты из URL —————
const params = new URLSearchParams(window.location.search);
const roomId = params.get('roomId');
if (!roomId) {
  alert('Не указан ID комнаты.');
  location.href = 'index.html';
}

// ————— Элементы страницы —————
const playerWrapper = document.getElementById('playerWrapper');
const backLink      = document.getElementById('backLink');
const msgInput      = document.getElementById('msgInput');
const sendBtn       = document.getElementById('sendBtn');
const messagesBox   = document.getElementById('messages');
const membersList   = document.getElementById('membersList');

let player;
let isSeeking = false;
let isRemoteAction = false;

// ————— Уведомляем сервер, что зашли —————
socket.emit('join',          { roomId, userData: { id: Date.now(), first_name: 'Гость' } });
socket.emit('request_state', { roomId });

// ————— Реалтайм: обновляем список участников —————
socket.on('members', members => {
  if (!Array.isArray(members)) return;
  const count = members.length;
  membersList.innerHTML = `
    <div class="chat-members-label">Участники (${count}):</div>
    <ul>
      ${members.map(m => `<li>${m.user_name || m.user_id}</li>`).join('')}
    </ul>
  `;
});

// ————— История чата и новые сообщения —————
socket.on('history', data => {
  messagesBox.innerHTML = '';
  data.forEach(m => appendMessage(m.author, m.text));
});
socket.on('chat_message', m => appendMessage(m.author, m.text));

// ————— Отправка сообщения —————
sendBtn.addEventListener('click', sendMessage);
msgInput.addEventListener('keydown', e => e.key === 'Enter' && sendMessage());
function sendMessage() {
  const text = msgInput.value.trim();
  if (!text) return;
  socket.emit('chat_message', { roomId, author: 'Гость', text });
  msgInput.value = '';
}

// ————— Синхронизация плеера —————
socket.on('sync_state', ({ position = 0, is_paused }) => {
  if (!player) return;
  isRemoteAction = true;
  player.currentTime = position;
  is_paused 
    ? player.pause() 
    : player.play().catch(()=>{});
  setTimeout(() => isRemoteAction = false, 200);
});

socket.on('player_update', ({ position = 0, is_paused }) => {
  if (!player) return;
  isRemoteAction = true;
  isSeeking = true;
  player.currentTime = position;
  is_paused 
    ? player.pause() 
    : player.play().catch(()=>{});
  setTimeout(() => {
    isSeeking = false;
    isRemoteAction = false;
  }, 200);
});

// ————— Загрузка данных комнаты и плеера —————
async function fetchRoom() {
  try {
    const res = await fetch(`${BACKEND}/api/rooms/${roomId}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const roomData = await res.json();
    if (!roomData) throw new Error('Комната не найдена');

    const movie = movies.find(m => m.id === roomData.movie_id);
    if (!movie || !movie.videoUrl) throw new Error('Фильм не найден');

    // назад к описанию фильма
    backLink.href = `movie.html?id=${movie.id}`;

    // отрисуем видео-контейнер без дополнительной кнопки
    playerWrapper.innerHTML = `
      <video id="videoPlayer" class="video-player" controls crossorigin="anonymous" playsinline></video>
    `;

    // покажем ID комнаты под плеером
    const idBadge = document.createElement('div');
    idBadge.className = 'room-id-badge';
    idBadge.innerHTML = `
      <small>ID комнаты:</small>
      <code>${roomId}</code>
      <button id="copyRoomId">Копировать</button>
    `;
    playerWrapper.after(idBadge);
    document.getElementById('copyRoomId')
      .addEventListener('click', () => {
        navigator.clipboard.writeText(roomId);
        alert('ID комнаты скопирован в буфер обмена');
      });

    const video = document.getElementById('videoPlayer');

    // HLS.js
    if (Hls.isSupported()) {
      const hls = new Hls({ debug: false });
      hls.loadSource(movie.videoUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.ERROR, (_, data) => {
        console.error('[HLS] Ошибка:', data);
        alert(`Ошибка загрузки видео.\nПроверьте CORS/CDN для ${window.location.origin}`);
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = movie.videoUrl;
    } else {
      throw new Error('Ваш браузер не поддерживает HLS');
    }

    // события управления пользователем
    video.addEventListener('play', () => {
      if (isSeeking || isRemoteAction) return;
      socket.emit('player_action', { roomId, position: video.currentTime, is_paused: false });
    });
    video.addEventListener('pause', () => {
      if (isSeeking || isRemoteAction) return;
      socket.emit('player_action', { roomId, position: video.currentTime, is_paused: true });
    });
    video.addEventListener('seeking', () => { isSeeking = true; });
    video.addEventListener('seeked', () => {
      if (!isRemoteAction) {
        socket.emit('player_action', { roomId, position: video.currentTime, is_paused: video.paused });
      }
      setTimeout(() => isSeeking = false, 200);
    });

    player = video;

  } catch (err) {
    console.error('[ERROR] Ошибка комнаты:', err);
    playerWrapper.innerHTML = `<p class="error">Ошибка: ${err.message}</p>`;
  }
}

fetchRoom();

// ————— Вспомогалка для чата —————
function appendMessage(author, text) {
  const div = document.createElement('div');
  div.className = 'chat-message';
  div.innerHTML = `<strong>${author}:</strong> ${text}`;
  messagesBox.appendChild(div);
  messagesBox.scrollTop = messagesBox.scrollHeight;
}
