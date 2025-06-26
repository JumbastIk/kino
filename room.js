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
const backLink      = document.getElementById('backLink');
const messagesBox   = document.getElementById('messages');
const membersList   = document.getElementById('membersList');
const msgInput      = document.getElementById('msgInput');
const sendBtn       = document.getElementById('sendBtn');

let player;
let isRemoteAction     = false;
let lastUpdate         = 0;
let myUserId           = null;
let initialSync        = null;
let syncTimeout        = null;
let lastPing           = 0;
let sendLock           = false;
let localSeeking       = false;
let wasPlayingBeforeSeek = false;

//
// 1) Меряем RTT каждые 10 секунд
//
function measurePing() {
  const t0 = Date.now();
  socket.emit('ping');
  socket.once('pong', () => {
    lastPing = Date.now() - t0;
  });
}
setInterval(measurePing, 10_000);

//
// 2) Троттлим отправку действий игрока
//
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

//
// 3) При подключении запрашиваем состояние и комнату
//
socket.on('connect', () => {
  myUserId = socket.id;
  socket.emit('join', { roomId, userData: { id: myUserId, first_name: 'Гость' } });
  socket.emit('request_state', { roomId });
  fetchRoom();
});

//
// 4) Чат и список участников
//
socket.on('members', ms => {
  membersList.innerHTML =
    `<div class="chat-members-label">Участники (${ms.length}):</div>` +
    `<ul>${ms.map(m=>`<li>${m.user_id}</li>`).join('')}</ul>`;
});
socket.on('history', data => {
  messagesBox.innerHTML = '';
  data.forEach(m => appendMessage(m.author, m.text));
});
socket.on('chat_message', m => appendMessage(m.author, m.text));
socket.on('system_message', msg => msg?.text && appendSystemMessage(msg.text));

sendBtn.addEventListener('click', sendMessage);
msgInput.addEventListener('keydown', e => e.key==='Enter' && sendMessage());
function sendMessage() {
  const t = msgInput.value.trim();
  if (!t) return;
  socket.emit('chat_message', { roomId, author:'Гость', text:t });
  msgInput.value = '';
}

//
// 5) Синхронизация с учётом пинга
//
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

  const now     = Date.now();
  const drift  = (now - serverTs) - lastPing/2;
  const target = isPaused ? pos : pos + drift/1000;
  const delta  = target - player.currentTime;
  const absD   = Math.abs(delta);

  if (absD > 1) {
    player.currentTime = target;
  } else if (absD > 0.05) {
    player.playbackRate = delta > 0 ? 1.05 : 0.95;
    setTimeout(() => player.playbackRate = 1, 500);
  }

  // Убираем remote-pause: не останавливаем видео по состоянию сервера
  if (!isPaused && player.paused) {
    player.play().catch(() => {});
  }

  setTimeout(() => isRemoteAction = false, 100);
}

socket.on('sync_state', d => {
  if (!player) {
    initialSync = d;
  } else if (localSeeking) {
    localSeeking = false;
  } else {
    debouncedSync(d.position, d.is_paused, d.updatedAt);
  }
});
socket.on('player_update', d => {
  if (localSeeking) {
    localSeeking = false;
  } else {
    debouncedSync(d.position, d.is_paused, d.updatedAt);
  }
});

//
// 6) Загрузка комнаты и инициализация плеера
//
async function fetchRoom(){
  try {
    const res = await fetch(`${BACKEND}/api/rooms/${roomId}`);
    if (!res.ok) throw new Error(res.status);
    const roomData = await res.json();

    const movie = movies.find(m => m.id === roomData.movie_id);
    if (!movie?.videoUrl) throw new Error('Фильм не найден');
    backLink.href = `${movie.html}?id=${movie.id}`;

    playerWrapper.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.style.position = 'relative';
    wrap.innerHTML = `
      <video id="videoPlayer" controls autoplay muted playsinline crossorigin="anonymous"
             style="width:100%;border-radius:14px"></video>`;
    wrap.appendChild(createSpinner());
    playerWrapper.appendChild(wrap);

    const badge = document.createElement('div');
    badge.className = 'room-id-badge';
    badge.innerHTML = `
      <small>ID комнаты:</small><code>${roomId}</code>
      <button id="copyRoomId">Копировать</button>`;
    playerWrapper.after(badge);
    document.getElementById('copyRoomId').onclick = () => {
      navigator.clipboard.writeText(roomId);
      alert('Скопировано');
    };

    const v = document.getElementById('videoPlayer');
    v.muted = true;
    if (window.Hls?.isSupported()) {
      const hls = new Hls();
      hls.loadSource(movie.videoUrl);
      hls.attachMedia(v);
      v.addEventListener('waiting',  () => document.querySelector('.buffer-spinner').style.display = 'block');
      v.addEventListener('playing', () => document.querySelector('.buffer-spinner').style.display = 'none');
    } else if (v.canPlayType('application/vnd.apple.mpegurl')) {
      v.src = movie.videoUrl;
    } else {
      throw new Error('HLS не поддерживается');
    }

    v.addEventListener('loadedmetadata', () => {
      if (initialSync) {
        doSync(initialSync.position, initialSync.is_paused, initialSync.updatedAt);
        initialSync = null;
      }
    });

    v.addEventListener('seeking', () => {
      if (!isRemoteAction) {
        localSeeking = true;
        wasPlayingBeforeSeek = !v.paused;
        if (syncTimeout) clearTimeout(syncTimeout);
      }
    });

    v.addEventListener('seeked', () => {
      if (!isRemoteAction) {
        if (wasPlayingBeforeSeek) {
          v.play().catch(() => {});
          emitPlayerActionThrottled(false);
        } else {
          v.pause();
          emitPlayerActionThrottled(true);
        }
      }
    });

    v.addEventListener('play',  () => { if (!isRemoteAction) emitPlayerActionThrottled(false); });
    v.addEventListener('pause', () => { if (!isRemoteAction) emitPlayerActionThrottled(true); });

    player = v;
  } catch(err) {
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

function appendMessage(author, text){
  const d = document.createElement('div');
  d.className = 'chat-message';
  d.innerHTML = `<strong>${author}:</strong> ${text}`;
  messagesBox.appendChild(d);
  messagesBox.scrollTop = messagesBox.scrollHeight;
}

function appendSystemMessage(text){
  const d = document.createElement('div');
  d.className = 'chat-message system-message';
  d.innerHTML = `<em>${text}</em>`;
  messagesBox.appendChild(d);
  messagesBox.scrollTop = messagesBox.scrollHeight;
}
