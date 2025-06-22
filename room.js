const socket = io();

const params = new URLSearchParams(window.location.search);
const roomId = params.get('roomId');
if (!roomId) {
  alert('Не указан ID комнаты.');
  location.href = 'index.html';
}

const tg = window.Telegram?.WebApp;
if (tg) tg.expand();

const user = tg?.initDataUnsafe?.user || {
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

let player;
let isSeeking = false;

socket.emit('join', { roomId, userData: user });
socket.emit('request_state', { roomId });

async function fetchRoom() {
  try {
    const res = await fetch(`${API_BASE}/api/rooms/${roomId}`);
    const roomData = await res.json();
    if (!roomData) throw new Error('Комната не найдена');

    const movie = movies.find(m => m.id === roomData.movie_id);
    if (!movie || !movie.videoUrl) throw new Error('Фильм не найден');

    backLink.href = `movie.html?id=${movie.id}`;

    playerWrapper.innerHTML = `<video id="videoPlayer" class="video-player" controls crossorigin="anonymous" playsinline></video>`;
    const video = document.getElementById('videoPlayer');

    console.log('[INFO] HLS URL:', movie.videoUrl);
    console.log('[INFO] Источник:', window.location.origin);
    console.log('[INFO] Протокол:', location.protocol);

    if (Hls.isSupported()) {
      const hls = new Hls({
        xhrSetup: function (xhr, url) {
          xhr.withCredentials = false;
          xhr.onload = () => console.log('[HLS] Загружен сегмент:', url);
          xhr.onerror = () => {
            console.error('[HLS] ❌ Ошибка загрузки сегмента:', url);
            alert(
              'Ошибка загрузки HLS потока.\n\nВозможная причина: сервер блокирует запрос по заголовку Referer или Origin.\n\nURL: ' +
              movie.videoUrl +
              '\nИсточник: ' + window.location.origin +
              '\n\nРешение:\n✔ Проверь настройки Pull Zone в BunnyCDN\n✔ Разреши домен: ' + window.location.origin
            );
          };
        }
      });
      hls.loadSource(movie.videoUrl);
      hls.attachMedia(video);
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = movie.videoUrl;
    } else {
      throw new Error('Ваш браузер не поддерживает HLS');
    }

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
    console.error('[ERROR] Ошибка загрузки комнаты:', err);
    playerWrapper.innerHTML = `<p class="error">Ошибка загрузки комнаты: ${err.message}</p>`;
  }
}
fetchRoom();

socket.on('history', data => {
  messagesBox.innerHTML = '';
  data.forEach(m => appendMessage(m.author, m.text));
});
socket.on('chat_message', m => appendMessage(m.author, m.text));

sendBtn.addEventListener('click', sendMessage);
msgInput.addEventListener('keydown', e => e.key === 'Enter' && sendMessage());

function sendMessage() {
  const text = msgInput.value.trim();
  if (!text) return;
  socket.emit('chat_message', { roomId, author: user.first_name, text });
  msgInput.value = '';
}

socket.on('sync_state', ({ position = 0, is_paused }) => {
  if (!player) return;
  player.currentTime = position;
  is_paused
    ? player.pause()
    : player.play().catch(err => {
        console.warn('[HLS] Автозапуск видео заблокирован:', err.message);
      });
});

socket.on('player_update', ({ position = 0, is_paused }) => {
  if (!player) return;
  isSeeking = true;
  player.currentTime = position;
  is_paused
    ? player.pause()
    : player.play().catch(err => {
        console.warn('[HLS] Автозапуск видео заблокирован:', err.message);
      });
  setTimeout(() => (isSeeking = false), 200);
});

socket.on('members', members => {
  membersList.innerHTML = `<div class="chat-members-label">Участники:</div>
    <ul>${members.map(id => `<li>${id}</li>`).join('')}</ul>`;
});

function appendMessage(author, text) {
  const div = document.createElement('div');
  div.className = 'chat-message';
  div.innerHTML = `<strong>${author}:</strong> ${text}`;
  messagesBox.appendChild(div);
  messagesBox.scrollTop = messagesBox.scrollHeight;
}
