// script.js

const API_BASE = window.location.hostname.includes('localhost')
  ? 'http://localhost:3000'
  : 'https://kino-fhwp.onrender.com';
const API_URL = `${API_BASE}/api/rooms`;

const socket = io(API_BASE, {
  path: '/socket.io',
  transports: ['websocket']
});

socket.on('connect_error', err => console.error('Socket.IO connect error:', err));
socket.on('connect', () => console.log('Socket.IO connected:', socket.id));
socket.on('room_created', room => addRoomToSlider(room, true));
socket.on('room_updated', ({ id, viewers }) => {
  const slide = document.querySelector(`.slide[data-room-id="${id}"]`);
  if (!slide) return;
  const viewersEl = slide.querySelector('.room-viewers');
  if (viewersEl) viewersEl.textContent = `${viewers} смотрят`;
});

function createMovieCard(movie) {
  const link = document.createElement('a');
  link.href = `movie.html?id=${encodeURIComponent(movie.id)}`;
  link.className = 'movie-link';
  link.style.textDecoration = 'none';
  link.innerHTML = `
    <div class="movie-card">
      <img src="${movie.poster}" alt="${movie.title}" />
      <h3>${movie.title}</h3>
      <p>${movie.desc}</p>
    </div>
  `;
  return link;
}

function renderMainSlider() {
  const main = document.getElementById('mainSlider');
  if (!main) return;
  const ids = (main.dataset.movieIds || '')
    .split(',').map(x => x.trim()).filter(Boolean);
  main.innerHTML = '';
  main.style.display = 'flex';
  main.style.overflowX = 'auto';
  movies
    .filter(m => ids.includes(m.id))
    .forEach(m => main.appendChild(createMovieCard(m)));
}

function renderCategories() {
  document.querySelectorAll('.category').forEach(sec => {
    const genre = sec.dataset.categoryId;
    const slider = sec.querySelector('.slider');
    if (!genre || !slider) return;
    slider.innerHTML = '';
    slider.style.display = 'flex';
    slider.style.overflowX = 'auto';
    movies
      .filter(m => m.category === genre)
      .forEach(m => slider.appendChild(createMovieCard(m)));
  });
}

function initSliderControls() {
  document.querySelectorAll('.slider-wrapper').forEach(wrap => {
    const slider = wrap.querySelector('.slider');
    const prev = wrap.querySelector('.slider-btn.prev');
    const next = wrap.querySelector('.slider-btn.next');
    if (!slider || !prev || !next) return;
    const step = slider.offsetWidth * 0.8;
    prev.addEventListener('click', () =>
      slider.scrollBy({ left: -step, behavior: 'smooth' })
    );
    next.addEventListener('click', () =>
      slider.scrollBy({ left: step, behavior: 'smooth' })
    );
  });
}

async function loadRooms() {
  const res = await fetch(API_URL);
  if (!res.ok) throw new Error(`Ошибка ${res.status} при загрузке комнат`);
  return res.json();
}

function addRoomToSlider(room, highlight = false) {
  const slider = document.getElementById('roomsSlider');
  if (!slider) return;
  if (slider.querySelector(`.slide[data-room-id="${room.id}"]`)) {
    // уже есть: обновим счётчик
    socket.emit('room_updated', { id: room.id, viewers: room.viewers });
    return;
  }
  const slide = document.createElement('div');
  slide.className = 'slide';
  slide.dataset.roomId = room.id;
  if (highlight) {
    slide.style.border = '2px solid #ff9800';
    slide.style.background = '#222';
  }
  slide.innerHTML = `
    <a
      href="room.html?roomId=${encodeURIComponent(room.id)}"
      class="room-link"
      style="text-decoration:none;color:inherit;"
    >
      <div class="room-icon">🎥</div>
      <div class="room-info">
        <div class="room-title">${room.title}</div>
        <div class="room-viewers">${room.viewers} смотрят</div>
      </div>
      <div class="room-timer">
        ${room.created_at
          ? new Date(room.created_at).toLocaleTimeString()
          : ''
        }
      </div>
    </a>
  `;
  slider.insertBefore(slide, slider.firstChild);
}

async function renderRooms(activeRoomId = null) {
  const slider = document.getElementById('roomsSlider');
  if (!slider) return;
  let rooms;
  try {
    rooms = await loadRooms();
  } catch (err) {
    slider.innerHTML = `<div style="color:red;padding:16px;">${err.message}</div>`;
    return;
  }
  slider.innerHTML = '';
  rooms.forEach(r => addRoomToSlider(r, activeRoomId === r.id));
}

async function createRoom(title) {
  if (!title) return;
  const btn = document.querySelector('button[onclick^="window.createRoom"]');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Создание...';
  }
  let newRoomId = null;
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title })
    });
    const data = await res.json();
    if (!res.ok || !data.id) throw new Error(data.details || 'Не удалось создать комнату');
    newRoomId = data.id;
  } catch (err) {
    alert('Ошибка при создании комнаты: ' + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Создать комнату';
    }
  }
  if (newRoomId) {
    renderRooms(newRoomId);
    // подсветим найденную комнату
    setTimeout(() => addRoomToSlider({ id: newRoomId, title, viewers: 1, created_at: new Date() }, true), 100);
  }
}

// === ПОИСК КОМНАТЫ ПО ID ===
async function searchRoomById() {
  const input = document.getElementById('joinRoomInput');
  const result = document.getElementById('joinRoomResult');
  if (!input || !result) return;
  const id = input.value.trim();
  result.textContent = '';
  if (!id) {
    result.textContent = 'Введите ID комнаты';
    return;
  }
  try {
    const res = await fetch(`${API_BASE}/api/rooms/${encodeURIComponent(id)}`);
    if (!res.ok) {
      if (res.status === 404) throw new Error('Комната не найдена');
      throw new Error(`Ошибка ${res.status}`);
    }
    const room = await res.json();
    result.innerHTML = `
      <div class="search-room">
        <strong>Найдена комната:</strong><br/>
        <a
          href="room.html?roomId=${encodeURIComponent(room.id)}"
          class="search-room-link"
          style="color:#ff9800; text-decoration:underline;"
        >
          ${room.title} (ID: ${room.id}) — ${room.viewers} смотрят
        </a>
      </div>
    `;
    // Подсветим карточку в слайдере, если она есть
    addRoomToSlider(room, true);
  } catch (err) {
    result.textContent = err.message;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  renderMainSlider();
  renderCategories();
  initSliderControls();
  renderRooms();
  window.createRoom = createRoom;

  const joinBtn = document.getElementById('joinRoomBtn');
  if (joinBtn) {
    joinBtn.addEventListener('click', searchRoomById);
  }
});
