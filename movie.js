// movie.js

const API_BASE = window.location.hostname.includes('localhost')
  ? 'http://localhost:3000'
  : 'https://kino-fhwp.onrender.com';

document.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  const movieId = params.get('id');

  if (!movieId) {
    document.body.innerHTML = `
      <p class="error" style="color:#f55; text-align:center; margin-top:50px;">
        ID фильма не указан.
      </p>`;
    return;
  }

  const movie = movies.find(m => m.id === movieId);
  if (!movie) {
    document.body.innerHTML = `
      <p class="error" style="color:#f55; text-align:center; margin-top:50px;">
        Фильм не найден.
      </p>`;
    return;
  }

  // Отрисовываем детали фильма
  const container = document.getElementById('detailContainer');
  container.innerHTML = `
    <img src="${movie.poster}" 
         alt="${movie.title}" 
         class="detail-poster" />
    <div class="detail-info">
      <h1>${movie.title}</h1>
      <p>${movie.desc}</p>
    </div>
  `;

  // Ссылка "Назад"
  const backLink = document.getElementById('backLink');
  if (backLink) backLink.href = 'index.html';

  // Кнопка создания комнаты
  const btnWrap        = document.getElementById('roomBtnContainer');
  const linkContainer = document.getElementById('newRoomLink');
  const btn            = document.createElement('button');

  btn.id        = 'createRoomBtn';
  btn.className = 'create-room-btn';
  btn.textContent = 'Создать комнату';
  btnWrap.appendChild(btn);

  btn.addEventListener('click', async () => {
    btn.disabled    = true;
    btn.textContent = 'Создание...';

    try {
      const res = await fetch(`${API_BASE}/api/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // убираем Referer, чтобы Telegram WebView не ставил свой
        referrerPolicy: 'no-referrer',
        body: JSON.stringify({
          title:   movie.title,
          movieId: movie.id
        })
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const { id } = await res.json();
      if (!id) {
        throw new Error('Не вернулся ID комнаты');
      }

      const roomURL = `room.html?roomId=${encodeURIComponent(id)}`;
      linkContainer.innerHTML = `
        <strong>Комната создана:</strong><br/>
        <a href="${roomURL}">${roomURL}</a>
      `;

      // Если хотите сразу переходить в комнату, раскомментируйте:
      // location.href = roomURL;

    } catch (err) {
      console.error('Ошибка при создании комнаты:', err);
      linkContainer.innerHTML = `
        <span class="error" style="color:#f55;">
          Ошибка: ${err.message}
        </span>
      `;
    } finally {
      btn.disabled    = false;
      btn.textContent = 'Создать комнату';
    }
  });
});
