const messages = [];

const API_BASE = window.location.origin.includes('localhost')
  ? 'http://localhost:3000'
  : 'https://kino-fhwp.onrender.com';

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
  console.log('[room.js] Страница комнаты загружена');

  const params = new URLSearchParams(window.location.search);
  const roomId = params.get('roomId');
  const backLink = document.getElementById('backLink');
  const playerWrapper = document.querySelector('.player-wrapper');

  if (!roomId) {
    document.body.innerHTML = '<p style="color:#f55; text-align:center; margin-top:50px;">ID комнаты не указан.</p>';
    return;
  }

  // 🔧 используем абсолютный путь
  let room = null;
  try {
    const res = await fetch(`${API_BASE}/api/rooms`);
    const rooms = await res.json();
    room = rooms.find(r => r.id === roomId);
  } catch (err) {
    console.error('[room.js] Ошибка загрузки комнат:', err);
    document.body.innerHTML = '<p style="color:#f55; text-align:center; margin-top:50px;">Ошибка загрузки комнаты.</p>';
    return;
  }

  if (!room) {
    console.error('[room.js] Комната не найдена:', roomId);
    document.body.innerHTML = '<p style="color:#f55; text-align:center; margin-top:50px;">Комната не найдена.</p>';
    return;
  }

  console.log('[room.js] Найдена комната:', room);

  const movie = movies.find(m => m.id === room.movie_id);
  if (!movie) {
    console.error('[room.js] Фильм не найден:', room.movie_id);
    document.body.innerHTML = '<p style="color:#f55; text-align:center; margin-top:50px;">Фильм не найден.</p>';
    return;
  }

  console.log('[room.js] Найден фильм:', movie);

  backLink.href = `movie.html?id=${encodeURIComponent(movie.id)}`;

  playerWrapper.innerHTML = `
    <iframe
      src="${movie.videoUrl}"
      style="border: none;"
      allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture;"
      allowfullscreen
      width="100%"
      height="500"
    ></iframe>
  `;

  const input = document.getElementById('chatInput');
  const sendBtn = document.getElementById('sendBtn');

  sendBtn.addEventListener('click', () => {
    const text = input.value.trim();
    if (!text) return;
    messages.push({ author: 'Вы', text });
    renderMessages();
    input.value = '';
  });

  input.addEventListener('keyup', e => {
    if (e.key === 'Enter') sendBtn.click();
  });
});
