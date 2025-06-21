// 💬 Чат
const messages = [];

// 📡 Адрес сервера
const API_BASE = 'https://kino-fhwp.onrender.com';

// ⚙️ Подключаем Socket.IO
const socket = io(API_BASE);

function renderMessages() {
  const box = document.getElementById('chatMessages');
  box.innerHTML = '';
  messages.forEach(m => {
    const div = document.createElement('div');
    div.className = 'chat-message';
    div.innerHTML = `<span class="author">${m.author}:</span> <span class="text">${m.text}</span>`;
    box.appendChild(div);
  });
  box.scrollTop = box.scrollHeight;
}

document.addEventListener('DOMContentLoaded', async () => {
  const params = new URLSearchParams(window.location.search);
  const roomId = params.get('roomId');
  if (!roomId) return alert('Нет roomId');

  // Получаем контейнеры
  const backLink = document.getElementById('backLink');
  const playerWrapper = document.querySelector('.player-wrapper');

  // Проверяем data.js
  if (typeof movies === 'undefined') {
    return document.body.innerHTML = '<p>Фильмы не загружены.</p>';
  }

  // Запрашиваем детали комнаты (чтобы получить movie_id)
  let room;
  try {
    const res = await fetch(`${API_BASE}/api/rooms`);
    const list = await res.json();
    room = list.find(r => r.id === roomId);
  } catch {
    return document.body.innerHTML = '<p>Не удалось загрузить комнату.</p>';
  }
  if (!room) return document.body.innerHTML = '<p>Комната не найдена.</p>';

  // Находим фильм
  const movie = movies.find(m => m.id === room.movie_id);
  if (!movie) return document.body.innerHTML = '<p>Фильм не найден.</p>';

  backLink.href = `movie.html?id=${encodeURIComponent(movie.id)}`;

  // ——————————————————————————————
  // Создаём HTML5-плеер вместо iframe
  playerWrapper.innerHTML = `
    <video id="videoPlayer" controls playsinline style="width:100%;max-width:800px;">
      <source src="${movie.videoUrl}" type="video/mp4" />
      Ваш браузер не поддерживает видео.
    </video>
  `;
  const video = document.getElementById('videoPlayer');

  // Подключаемся по WebSocket и присоединяемся к комнате
  socket.emit('join', { roomId });
  
  // Получаем начальное состояние плеера
  socket.on('syncState', state => {
    if (state.videoId && state.videoId !== movie.id) {
      // Если в будущем будут несколько видео — можно здесь сменить источник
    }
    // Вычисляем текущую позицию, если видео играет
    let t = state.time;
    if (state.playing) {
      const delta = (Date.now() - state.lastUpdate) / 1000;
      t += delta;
    }
    video.currentTime = t;
    video.playbackRate = state.speed;
    if (state.playing) video.play();
    else video.pause();
  });

  // Обработчики входящих команд от других участников
  socket.on('play', ({ time, speed, timestamp }) => {
    const delta = (Date.now() - timestamp) / 1000;
    video.currentTime = time + delta;
    video.playbackRate = speed || 1;
    video.play();
  });
  socket.on('pause', ({ time }) => {
    video.currentTime = time;
    video.pause();
  });
  socket.on('seek', ({ time }) => {
    video.currentTime = time;
  });
  socket.on('changeVideo', state => {
    // Единый обработчик смены видео, если будет несколько
    video.src = movies.find(m => m.id === state.videoId).videoUrl;
    video.load();
    video.currentTime = state.time;
    if (state.playing) video.play();
  });

  // ——————————————————————————————
  // Отправляем свои действия
  video.addEventListener('play', () => {
    socket.emit('play', { time: video.currentTime, speed: video.playbackRate });
  });
  video.addEventListener('pause', () => {
    socket.emit('pause', { time: video.currentTime });
  });
  video.addEventListener('seeked', () => {
    socket.emit('seek', { time: video.currentTime });
  });
  video.addEventListener('ratechange', () => {
    socket.emit('play', { time: video.currentTime, speed: video.playbackRate });
  });

  // ——————————————————————————————
  // Чат (как было)
  const input = document.getElementById('chatInput');
  const sendBtn = document.getElementById('sendBtn');
  sendBtn.addEventListener('click', () => {
    const text = input.value.trim();
    if (!text) return;
    messages.push({ author: 'Вы', text });
    renderMessages();
    input.value = '';
  });
  input.addEventListener('keyup', e => { if (e.key==='Enter') sendBtn.click(); });
});
