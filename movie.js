document.addEventListener('DOMContentLoaded', () => {
  const API_BASE = window.location.origin.includes('localhost')
    ? 'http://localhost:3000'
    : 'https://kino-fhwp.onrender.com';

  // 1. Находим фильм по id из URL
  const params   = new URLSearchParams(window.location.search);
  const movieId  = params.get('id');
  const movie    = movies.find(m => m.id === movieId);

  const container     = document.getElementById('detailContainer');
  const btnWrap       = document.getElementById('roomBtnContainer');
  const linkContainer = document.getElementById('newRoomLink');
  const backLink      = document.getElementById('backLink');

  if (!movie) {
    container.innerHTML = '<p style="color:#f55;">Фильм не найден.</p>';
    return;
  }

  // Ссылка «Назад»
  backLink.href = 'index.html';

  // 2. Рендерим постер и описание
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

  // 3. Создаём кнопку «Создать комнату»
  const btn = document.createElement('button');
  btn.id = 'createRoomBtn';
  btn.className = 'create-room-btn';
  btn.textContent = 'Создать комнату';
  btnWrap.appendChild(btn);

  // 4. Обработчик клика по кнопке
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

      const data = await res.json();

      if (data.id) {
        const roomURL = `room.html?roomId=${encodeURIComponent(data.id)}`;
        linkContainer.innerHTML = `
          <strong>Комната создана:</strong>
          <a href="${roomURL}">${roomURL}</a>
        `;
      } else {
        linkContainer.innerHTML = `<span style="color:red;">Ошибка создания комнаты</span>`;
      }
    } catch (err) {
      linkContainer.innerHTML = `<span style="color:red;">Ошибка: ${err.message}</span>`;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Создать комнату';
    }
  });
});
