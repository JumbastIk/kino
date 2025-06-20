// movie.js

// Адаптивный базовый URL API (чтобы работало и на localhost, и в проде)
const API_BASE = window.location.origin.includes('localhost')
  ? 'http://localhost:3000'
  : 'https://kino-fhwp.onrender.com';

document.addEventListener('DOMContentLoaded', () => {
  // 1) Получаем ID фильма из URL
  const params = new URLSearchParams(window.location.search);
  const movieId = params.get('id');
  if (!movieId) {
    document.body.innerHTML = '<p style="color:#f55; text-align:center; margin-top:50px;">ID фильма не указан.</p>';
    return;
  }

  // 2) Ищем фильм в data.js
  const movie = movies.find(m => m.id === movieId);
  if (!movie) {
    document.body.innerHTML = '<p style="color:#f55; text-align:center; margin-top:50px;">Фильм не найден.</p>';
    return;
  }

  // 3) Рендерим постер и описание
  const container = document.getElementById('detailContainer');
  container.innerHTML = `
    <img
      src="${movie.poster}"
      alt="${movie.title}"
      class="detail-poster"
    />
    <div class="detail-info">
      <h1>${movie.title}</h1>
      <p>${movie.desc}</p>
    </div>
  `;

  // 4) Настраиваем ссылку «Назад»
  const backLink = document.getElementById('backLink');
  backLink.href = 'index.html';

  // 5) Рисуем кнопку «Создать комнату»
  const btnWrap = document.getElementById('roomBtnContainer');
  const linkContainer = document.getElementById('newRoomLink');
  const btn = document.createElement('button');
  btn.id = 'createRoomBtn';
  btn.className = 'create-room-btn';
  btn.textContent = 'Создать комнату';
  btnWrap.appendChild(btn);

  // 6) Обработчик клика по кнопке
  btn.addEventListener('click', async e => {
    e.preventDefault();
    btn.disabled = true;
    btn.textContent = 'Создание...';

    try {
      const res = await fetch(`${API_BASE}/api/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: movie.title,
          movieId: movie.id
        })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const { id } = await res.json();
      if (id) {
        // 7) Показываем ссылку на новую комнату
        const roomURL = `room.html?roomId=${encodeURIComponent(id)}`;
        linkContainer.innerHTML = `
          <strong>Комната создана:</strong>
          <a href="${roomURL}">${roomURL}</a>
        `;
      } else {
        linkContainer.innerHTML = `<span style="color:red;">Не удалось получить ID комнаты</span>`;
      }
    } catch (err) {
      console.error('Ошибка при создании комнаты:', err);
      linkContainer.innerHTML = `<span style="color:red;">Ошибка: ${err.message}</span>`;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Создать комнату';
    }
  });
});