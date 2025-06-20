// ====== ФУНКЦИИ ДЛЯ ФИЛЬМОВ И КАТЕГОРИЙ ======

// Создаёт кликабельную карточку фильма (ведёт на movie.html?id=…)
function createMovieCard(movie) {
  const link = document.createElement('a');
  link.href = `movie.html?id=${encodeURIComponent(movie.id)}`;
  link.className = 'movie-link';
  link.style.textDecoration = 'none';

  const card = document.createElement('div');
  card.className = 'movie-card';
  card.innerHTML = `
    <img src="${movie.poster}" alt="${movie.title}" />
    <h3>${movie.title}</h3>
    <p>${movie.desc}</p>
  `;
  link.appendChild(card);
  return link;
}

// Рендерит главный слайдер по data-movie-ids
function renderMainSlider() {
  const main = document.getElementById('mainSlider');
  if (!main) return;

  const ids = (main.dataset.movieIds || '')
    .split(',')
    .map(x => x.trim())
    .filter(Boolean);

  main.innerHTML = '';
  main.style.display = 'flex';
  main.style.overflowX = 'auto';

  movies
    .filter(m => ids.includes(m.id))
    .forEach(m => main.appendChild(createMovieCard(m)));
}

// Рендерит карусели по категориям
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

// Подключает стрелки ‹ › для всех слайдеров
function initSliderControls() {
  document.querySelectorAll('.slider-wrapper').forEach(wrap => {
    const slider = wrap.querySelector('.slider');
    const prevBtn = wrap.querySelector('.slider-btn.prev');
    const nextBtn = wrap.querySelector('.slider-btn.next');
    if (!slider || !prevBtn || !nextBtn) return;

    const step = slider.offsetWidth * 0.8;
    prevBtn.addEventListener('click', () => {
      slider.scrollBy({ left: -step, behavior: 'smooth' });
    });
    nextBtn.addEventListener('click', () => {
      slider.scrollBy({ left: step, behavior: 'smooth' });
    });
  });
}

// ====== ЛОГИКА ОНЛАЙН-КОМНАТ ЧЕРЕЗ API и SOCKET.IO ======

const API_URL = '/api/rooms';
const socket = io(); // Подключение к серверу Socket.io

// Получить список комнат с сервера
async function loadRooms() {
  const res = await fetch(API_URL);
  if (!res.ok) throw new Error('Ошибка загрузки комнат');
  return await res.json();
}

// Добавить одну комнату в слайдер (в начало)
function addRoomToSlider(room, highlight = false) {
  const slider = document.getElementById('roomsSlider');
  if (!slider) return;
  const slide = document.createElement('div');
  slide.className = 'slide';
  if (highlight) {
    slide.style.border = '2px solid #ff9800';
    slide.style.background = '#222';
  }
  slide.innerHTML = `
    <a href="room.html?roomId=${encodeURIComponent(room.id)}" class="room-link">
      <div class="room-icon">🎥</div>
      <div class="room-info">
        <div class="room-title">${room.title}</div>
        <div class="room-viewers">${room.viewers || 1} смотрят</div>
      </div>
      <div class="room-timer">${room.created_at ? new Date(room.created_at).toLocaleTimeString() : ''}</div>
    </a>
  `;
  slider.insertBefore(slide, slider.firstChild);
}

// Рендерит список комнат в слайдере
async function renderRooms(highlightRoomId = null) {
  const slider = document.getElementById('roomsSlider');
  if (!slider) return;
  let rooms = [];
  try {
    rooms = await loadRooms();
  } catch (e) {
    slider.innerHTML = '<div style="color:red;padding:16px;">Ошибка загрузки комнат</div>';
    return;
  }

  slider.innerHTML = '';
  rooms.forEach(room => {
    addRoomToSlider(room, highlightRoomId && room.id === highlightRoomId);
  });
}

// Создать новую комнату
async function createRoom(title) {
  if (!title) return;
  const btn = document.querySelector('button[onclick^="window.createRoom"]');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Создание...';
  }
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title })
    });
    const data = await res.json();
    const input = document.getElementById('newRoomTitle');
    if (input) input.value = '';
    // Не обновляем список — новая комната появится через Socket.io
  } catch (e) {
    alert('Ошибка при создании комнаты: ' + e.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Создать комнату';
    }
  }
}

// ====== SOCKET.IO: слушаем появление новых комнат ======
socket.on('room_created', (room) => {
  addRoomToSlider(room, true);
});

// ====== СТАРТ ПО ГРУЗКЕ СТРАНИЦЫ ======
document.addEventListener('DOMContentLoaded', () => {
  renderMainSlider();
  renderCategories();
  initSliderControls();
  renderRooms();
});

// Экспортируем функцию для кнопки создания комнаты
window.createRoom = createRoom;