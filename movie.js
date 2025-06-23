// movie.js

const API_BASE = window.location.hostname.includes('localhost')
  ? 'http://localhost:3000'
  : 'https://kino-fhwp.onrender.com';

document.addEventListener('DOMContentLoaded', () => {
  const params  = new URLSearchParams(window.location.search);
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

  // Рисуем обложку, описание и плеер
  const container = document.getElementById('detailContainer');
  container.innerHTML = `
    <img src="${movie.poster}"
         alt="${movie.title}"
         class="detail-poster" />
    <div class="detail-info">
      <h1>${movie.title}</h1>
      <p>${movie.desc}</p>
    </div>
    <div id="playerWrapper">
      <video
        id="videoPlayer"
        class="video-player"
        controls
        crossorigin="anonymous"
        playsinline
        style="width:100%; max-width:800px;"
      ></video>
    </div>
    <div id="roomBtnContainer" style="margin-top:16px;"></div>
    <div id="newRoomLink" style="margin-top:8px;"></div>
  `;

  // "Назад" возвращает на список
  const backLink = document.getElementById('backLink');
  if (backLink) backLink.href = 'index.html';

  const video = document.getElementById('videoPlayer');

  // Подключаем HLS.js (никаких нативных fallback)
  if (Hls.isSupported()) {
    const hls = new Hls({ debug: false });
    hls.loadSource(movie.videoUrl);
    hls.attachMedia(video);
    hls.on(Hls.Events.ERROR, (event, data) => {
      console.error('[HLS] Ошибка:', data);
      alert(
        'Ошибка загрузки видео.\n' +
        'Проверьте настройки CDN и CORS для домена:\n' +
        window.location.origin
      );
    });
  } else {
    document.getElementById('playerWrapper').innerHTML =
      '<p class="error">Ваш браузер не поддерживает HLS.</p>';
  }

  // — Создание комнаты —
  const btnWrap       = document.getElementById('roomBtnContainer');
  const linkContainer = document.getElementById('newRoomLink');

  const btn = document.createElement('button');
  btn.id          = 'createRoomBtn';
  btn.type        = 'button';
  btn.className   = 'create-room-btn';
  btn.textContent = 'Создать комнату';
  btn.style.marginRight = '8px';
  btnWrap.appendChild(btn);

  btn.addEventListener('click', async e => {
    e.preventDefault();
    btn.disabled    = true;
    btn.textContent = 'Создание...';

    try {
      const res = await fetch(`${API_BASE}/api/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        referrerPolicy: 'no-referrer',
        body: JSON.stringify({
          title:   movie.title,
          movieId: movie.id
        })
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { id } = await res.json();
      if (!id) throw new Error('Не вернулся ID комнаты');

      const roomURL = `room.html?roomId=${encodeURIComponent(id)}`;
      linkContainer.innerHTML = `
        <strong>Комната создана:</strong><br/>
        <a href="${roomURL}">${roomURL}</a>
      `;
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
