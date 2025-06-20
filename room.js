// ===== ПАРАМЕТРЫ =====
const ROOM_TTL = 5 * 60 * 1000;

function loadRooms() {
  return JSON.parse(localStorage.getItem('rooms') || '[]');
}
function saveRooms(rooms) {
  localStorage.setItem('rooms', JSON.stringify(rooms));
}
function cleanupExpiredRooms() {
  const now = Date.now();
  let rooms = loadRooms();
  rooms = rooms.filter(r =>
    !r.lastActive || (now - r.lastActive < ROOM_TTL)
  );
  saveRooms(rooms);
}

const messages = [];
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

document.addEventListener('DOMContentLoaded', () => {
  console.log('[room.js] Страница комнаты загружена');
  cleanupExpiredRooms();
  const rooms = loadRooms();

  const params  = new URLSearchParams(window.location.search);
  const roomId  = params.get('roomId');
  const backLink = document.getElementById('backLink');
  const playerWrapper = document.querySelector('.player-wrapper');

  console.log('[room.js] roomId из URL:', roomId);

  const room = rooms.find(r => r.id === roomId);
  if (!room) {
    console.error('[room.js] Комната не найдена:', roomId);
    document.body.innerHTML = '<p style="color:#f55; text-align:center; margin-top:50px;">Комната не найдена.</p>';
    return;
  }
  console.log('[room.js] Найдена комната:', room);

  room.viewers    = (room.viewers || 0) + 1;
  room.lastActive = Date.now();
  saveRooms(rooms);

  // ОЧИЩАЕМ videoUrl у комнаты, чтобы не было старых play-ссылок
  // и всегда используем только movie.videoUrl (embed-ссылку)
  const movie = movies.find(m => m.id === room.movieId);
  if (!movie) {
    console.error('[room.js] Фильм не найден:', room.movieId);
    document.body.innerHTML = '<p style="color:#f55; text-align:center; margin-top:50px;">Фильм не найден.</p>';
    return;
  }
  console.log('[room.js] Найден фильм:', movie);

  backLink.href = `movie.html?id=${encodeURIComponent(room.movieId)}`;

  // Вставляем iframe-плеер Bunny.net (только embed-ссылка!)
  playerWrapper.innerHTML = `<iframe
    src="${movie.videoUrl}"
    style="border: none;"
    allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture;"
    allowfullscreen
    width="100%"
    height="500"
  ></iframe>`;

  // Чат
  const input   = document.getElementById('chatInput');
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