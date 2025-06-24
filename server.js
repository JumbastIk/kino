const BACKEND = window.location.hostname.includes('localhost')
  ? 'http://localhost:3000'
  : 'https://kino-fhwp.onrender.com';

const socket = io(BACKEND, {
  path: '/socket.io',
  transports: ['websocket']
});

const params = new URLSearchParams(window.location.search);
const roomId = params.get('roomId');
if (!roomId) {
  alert('Не указан ID комнаты.');
  location.href = 'index.html';
}

const playerWrapper = document.getElementById('playerWrapper');
const backLink      = document.getElementById('backLink');
const messagesBox   = document.getElementById('messages');
const membersList   = document.getElementById('membersList');
const msgInput      = document.getElementById('msgInput');
const sendBtn       = document.getElementById('sendBtn');

let player, isSeeking = false, isRemoteAction = false;

// ====== Голосовой чат ======
if (typeof window.setupWebRTC === "function") {
  window.setupWebRTC({ socket, roomId, membersListSelector: '#membersList', micBtnParent: '.chat-input-wrap' });
}

// ====== Текстовый чат ======
if (typeof window.setupChat === "function") {
  window.setupChat({ socket, roomId, messagesBox, msgInput, sendBtn });
}

// =========== UI, плеер, синхронизация ===========

socket.emit('join',          { roomId, userData: { id: socket.id, first_name: 'Гость' } });
socket.emit('request_state', { roomId });

socket.on('sync_state', applySyncState);
socket.on('player_update', applySyncState);

function applySyncState({ position = 0, is_paused }) {
  if (!player) return;
  isRemoteAction = true;
  isSeeking = true;
  player.currentTime = position;
  if (is_paused) {
    player.pause();
  } else {
    player.play().catch(() => {});
  }
  setTimeout(() => {
    isRemoteAction = false;
    isSeeking = false;
  }, 200);
}

function createSpinner() {
  const s = document.createElement('div');
  s.className = 'buffer-spinner';
  s.innerHTML =
    `<div class="double-bounce1"></div>
    <div class="double-bounce2"></div>`;
  s.style.display = 'none';
  return s;
}

async function fetchRoom() {
  try {
    const res = await fetch(`${BACKEND}/api/rooms/${roomId}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const roomData = await res.json();

    // movies должен быть определён через data.js до этого файла!
    const movie = window.movies.find(m => m.id === roomData.movie_id);
    if (!movie || !movie.videoUrl) throw new Error('Фильм не найден');
    backLink.href = `${movie.html}?id=${movie.id}`;

    playerWrapper.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.style.position = 'relative';
    wrap.innerHTML =
      `<video id="videoPlayer" controls crossorigin="anonymous" playsinline
             style="width:100%;border-radius:14px"></video>`;
    const spinner = createSpinner();
    wrap.appendChild(spinner);
    playerWrapper.appendChild(wrap);

    const badge = document.createElement('div');
    badge.className = 'room-id-badge';
    badge.innerHTML =
      `<small>ID комнаты:</small>
      <code>${roomId}</code>
      <button id="copyRoomId">Копировать</button>`;
    playerWrapper.after(badge);
    document.getElementById('copyRoomId').onclick = () => {
      navigator.clipboard.writeText(roomId);
      alert('ID комнаты скопирован');
    };

    const v = document.getElementById('videoPlayer');
    if (window.Hls && window.Hls.isSupported()) {
      const hls = new Hls({ debug: false });
      hls.loadSource(movie.videoUrl);
      hls.attachMedia(v);
      hls.on(Hls.Events.ERROR, (_, data) => {
        console.error('[HLS] Ошибка:', data);
        alert('Ошибка загрузки видео');
      });
      v.addEventListener('waiting', () => spinner.style.display = 'block');
      v.addEventListener('playing', () => spinner.style.display = 'none');
    } else if (v.canPlayType('application/vnd.apple.mpegurl')) {
      v.src = movie.videoUrl;
    } else {
      throw new Error('Ваш браузер не поддерживает HLS');
    }

    v.addEventListener('play', () => {
      if (isSeeking || isRemoteAction) return;
      socket.emit('player_action', {
        roomId,
        position: v.currentTime,
        is_paused: false
      });
    });
    v.addEventListener('pause', () => {
      if (isSeeking || isRemoteAction) return;
      socket.emit('player_action', {
        roomId,
        position: v.currentTime,
        is_paused: true
      });
    });
    v.addEventListener('seeking', () => { isSeeking = true; });
    v.addEventListener('seeked', () => {
      if (!isRemoteAction) {
        socket.emit('player_action', {
          roomId,
          position: v.currentTime,
          is_paused: v.paused
        });
      }
      setTimeout(() => isSeeking = false, 200);
    });

    player = v;

  } catch (err) {
    console.error('[ERROR] Ошибка комнаты:', err);
    playerWrapper.innerHTML = `<p class="error">Ошибка: ${err.message}</p>`;
  }
}

fetchRoom();
