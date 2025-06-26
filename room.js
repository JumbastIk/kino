// room.js

const BACKEND = location.hostname.includes('localhost')
  ? 'http://localhost:3000'
  : 'https://kino-fhwp.onrender.com';

const socket = io(BACKEND, {
  path: '/socket.io',
  transports: ['websocket']
});

const params = new URLSearchParams(location.search);
const roomId = params.get('roomId');
if (!roomId) {
  alert('Не указан ID комнаты.');
  location.href = 'index.html';
}

const playerWrapper = document.getElementById('playerWrapper');
// ... остальной DOM-элемент ссылки и чата

let player;
let isRemoteAction = false;
let lastUpdate     = 0;
let myUserId       = null;
let initialSync    = null;
let syncTimeout    = null;
let localSeeking   = false;
let lastPing       = 0;
let sendLock       = false;

//––– 1) Меряем RTT ––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––
function measurePing() {
  const t0 = Date.now();
  socket.emit('ping');
  socket.once('pong', () => {
    lastPing = Date.now() - t0;
  });
}
setInterval(measurePing, 10_000);

//––– 2) Троттлинг отправки действий ––––––––––––––––––––––––––––––––––––––––––––
function emitPlayerActionThrottled(isPaused) {
  if (sendLock) return;
  socket.emit('player_action', {
    roomId,
    position:  player.currentTime,
    is_paused: isPaused,
    speed:     player.playbackRate
  });
  sendLock = true;
  setTimeout(() => sendLock = false, 150);
}

//––– 3) Подключаемся и запрашиваем состояние ––––––––––––––––––––––––––––––––––––
socket.on('connect', () => {
  myUserId = socket.id;
  socket.emit('join', { roomId, userData: { id: myUserId, first_name: 'Гость' } });
  socket.emit('request_state', { roomId });
  fetchRoom();
});

//––– 4) Обработка чата и списка участников ––––––––––––––––––––––––––––––––––––––
// (без изменений) …

//––– 5) Функции синхронизации –––––––––––––––––––––––––––––––––––––––––––––––––
function debouncedSync(pos, isPaused, serverTs) {
  if (syncTimeout) clearTimeout(syncTimeout);
  syncTimeout = setTimeout(() => {
    doSync(pos, isPaused, serverTs);
  }, 50);
}

function doSync(pos, isPaused, serverTs) {
  if (serverTs < lastUpdate) return;
  lastUpdate = serverTs;
  if (!player) return;
  isRemoteAction = true;

  const now      = Date.now();
  const driftMs  = (now - serverTs) - lastPing/2;
  const target   = isPaused ? pos : pos + driftMs/1000;
  const delta    = target - player.currentTime;
  const absDelta = Math.abs(delta);

  // Если очень далеко — телепортируемся
  if (absDelta > 1) {
    player.currentTime = target;
  }
  // Иначе едва подстраиваем скорость
  else if (absDelta > 0.05) {
    player.playbackRate = delta > 0 ? 1.05 : 0.95;
    setTimeout(() => { if (player) player.playbackRate = 1; }, 500);
  }

  // Пауза / Play
  if (isPaused && !player.paused) {
    player.pause();
  } else if (!isPaused && player.paused) {
    player.play().catch(() => {
      if (!window.__autoplayWarned) {
        window.__autoplayWarned = true;
        alert('Нажмите по видео для автозапуска');
      }
    });
  }

  setTimeout(() => isRemoteAction = false, 100);
}

// Приходящее состояние от сервера
socket.on('sync_state', d => {
  if (!player) {
    // сохраняем до инициализации плеера
    initialSync = d;
  } else if (localSeeking) {
    localSeeking = false;
  } else {
    debouncedSync(d.position, d.is_paused, d.updatedAt);
  }
});
socket.on('player_update', d => {
  // можно объединить с sync_state, если хотите
  if (localSeeking) {
    localSeeking = false;
  } else {
    debouncedSync(d.position, d.is_paused, d.updatedAt);
  }
});

//––– 6) Инициализация плеера ––––––––––––––––––––––––––––––––––––––––––––––––––
async function fetchRoom(){
  try {
    const res = await fetch(`${BACKEND}/api/rooms/${roomId}`);
    if (!res.ok) throw new Error(res.status);
    const roomData = await res.json();
    const movie = movies.find(m => m.id === roomData.movie_id);
    if (!movie?.videoUrl) throw new Error('Фильм не найден');

    // Ссылка «назад»
    backLink.href = `${movie.html}?id=${movie.id}`;

    // Вставляем video
    playerWrapper.innerHTML = `
      <div style="position:relative">
        <video id="videoPlayer" controls crossorigin="anonymous" playsinline
               style="width:100%;border-radius:14px"></video>
      </div>
    `;
    const spinner = createSpinner();
    playerWrapper.querySelector('div').appendChild(spinner);

    const v = document.getElementById('videoPlayer');
    // На всякий случай убедимся, что controls точно вкл.
    v.controls = true;

    // HLS.js
    if (window.Hls?.isSupported()) {
      const hls = new Hls();
      hls.loadSource(movie.videoUrl);
      hls.attachMedia(v);

      // Ждём, когда плейлист распарсится, чтобы инициализировать seek
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        spinner.style.display = 'none';
        if (initialSync) {
          doSync(
            initialSync.position,
            initialSync.is_paused,
            initialSync.updatedAt
          );
          initialSync = null;
        }
      });

      v.addEventListener('waiting', ()=> spinner.style.display='block');
      v.addEventListener('playing',()=> spinner.style.display='none');

    }
    // Нативный HLS (Safari)
    else if (v.canPlayType('application/vnd.apple.mpegurl')) {
      v.src = movie.videoUrl;
      v.load();  // важно — сразу загрузить метаданные
      v.addEventListener('loadedmetadata', () => {
        spinner.style.display = 'none';
        if (initialSync) {
          doSync(
            initialSync.position,
            initialSync.is_paused,
            initialSync.updatedAt
          );
          initialSync = null;
        }
      });
    } else {
      throw new Error('HLS не поддерживается');
    }

    // Локальный seek
    v.addEventListener('seeking', () => {
      if (!isRemoteAction) {
        localSeeking = true;
        if (syncTimeout) {
          clearTimeout(syncTimeout);
          syncTimeout = null;
        }
      }
    });
    v.addEventListener('seeked', () => {
      if (!isRemoteAction) {
        emitPlayerActionThrottled(v.paused);
      }
    });

    // Play/Pause
    v.addEventListener('play',  () => { if (!isRemoteAction) emitPlayerActionThrottled(false); });
    v.addEventListener('pause', () => { if (!isRemoteAction) emitPlayerActionThrottled(true); });

    player = v;

  } catch(err){
    console.error(err);
    playerWrapper.innerHTML = `<p class="error">Ошибка: ${err.message}</p>`;
  }
}

function createSpinner(){
  const s = document.createElement('div');
  s.className = 'buffer-spinner';
  s.innerHTML = `<div class="double-bounce1"></div><div class="double-bounce2"></div>`;
  s.style.display = 'none';
  return s;
}

// … Остальные функции чата и сообщений без изменений …
