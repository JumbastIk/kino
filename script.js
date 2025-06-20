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

// ====== ЛОГИКА ОНЛАЙН‐КОМНАТ ЧЕРЕЗ API ======

// URL до твоего API (замени на свой домен, если не localhost)
const API_URL = 'https://www.dsgsasd.ru/api/rooms';

// Получить список комнат с сервера
async function loadRooms() {
  const res = await fetch(API_URL);
  return await res.json();
}

// Создать новую комнату
async function createRoom(title) {
  if (!title) return;
  await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title })
  });
  await renderRooms();
}

// Рендерит список комнат в слайдере
async function renderRooms() {
  const rooms = await loadRooms();
  const slider = document.getElementById('roomsSlider');
  if (!slider) return;

  slider.innerHTML = '';
  rooms.forEach(room => {
    const slide = document.createElement('div');
    slide.className = 'slide';
    slide.innerHTML = `
      <a href="room.html?roomId=${encodeURIComponent(room.id)}" class="room-link">
        <div class="room-icon">🎥</div>
        <div class="room-info">
          <div class="room-title">${room.title}</div>
          <div class="room-viewers">${room.viewers || 1} смотрят</div>
        </div>
        <div class="room-timer">${room.createdAt ? new Date(room.createdAt).toLocaleTimeString() : ''}</div>
      </a>
    `;
    slider.appendChild(slide);
  });
}

// ====== СТАРТ ПО ГРУЗКЕ СТРАНИЦЫ ======
document.addEventListener('DOMContentLoaded', () => {
  renderMainSlider();
  renderCategories();
  initSliderControls();
  renderRooms();
});

// Экспортируем функцию для кнопки создания комнаты
window.createRoom = createRoom;