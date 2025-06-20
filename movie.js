document.addEventListener('DOMContentLoaded', () => {
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
  btn.addEventListener('click', e => {
    e.preventDefault();

    // Генерируем уникальный ID комнаты
    const roomId = 'room_' + Date.now();

    // Формируем URL для новой комнаты (относительный путь)
    const roomURL = `room.html?roomId=${encodeURIComponent(roomId)}`;

    // Выводим ссылку под кнопкой
    linkContainer.innerHTML = `
      <strong>Комната создана:</strong>
      <a href="${roomURL}">${roomURL}</a>
    `;

    // Сохраняем метаданные в localStorage, включая videoUrl
    const existing = JSON.parse(localStorage.getItem('rooms') || '[]');
    existing.push({
      id: roomId,
      movieId: movieId,
      title: movie.title,
      viewers: 1,
      videoUrl: movie.videoUrl // обязательно сохраняем ссылку на видео!
    });
    localStorage.setItem('rooms', JSON.stringify(existing));
  });
});