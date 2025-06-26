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
let spinner;
let isRemoteAction     = false;
let lastUpdate         = 0;
let lastPing           = 0;
let myUserId           = null;
let initialSync        = null;
let syncTimeout        = null;
let localSeeking       = false;
let wasPlayingBeforeSeek = false;
let metadataReady      = false;

// пороги синхронизации
const HARD_SYNC_THRESHOLD   = 0.5;   // сек — мгновенный "скачок"
const SOFT_SYNC_THRESHOLD   = 0.1;   // сек — плавная подтяжка через playbackRate
const AUTO_RESYNC_THRESHOLD = 0.8;   // сек — если разброд слишком большой

// 1) меряем RTT раз в 10с
function measurePing() {
  const t0 = Date.now();
  socket.emit('ping');
  socket.once('pong', () => {
    lastPing = Date.now() - t0;
  });
}
setInterval(measurePing, 10_000);

// 2) подключаемся, запрашиваем стейт и комнату
socket.on('connect', () => {
  myUserId = socket.id;
  socket.emit('join',          { roomId, userData: { id: myUserId, first_name: 'Гость' } });
  socket.emit('request_state', { roomId });
  fetchRoom();
});
socket.on('reconnect', () => {
  socket.emit('request_state', { roomId });
});

// чат и участники
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
msgInput.addEventListener('keydown', e => {
  if (e.key==='Enter') sendMessage();
});
function sendMessage() {
  const t = msgInput.value.trim();
  if (!t) return;
  socket.emit('chat_message', { roomId, author:'Гость', text:t });
  msgInput.value = '';
}

// 3) входящие обновления от сервера
socket.on('sync_state',   d => handleIncoming(d));
socket.on('player_update',d => handleIncoming(d));

function handleIncoming(d) {
  initialSync = d;
  if (metadataReady) {
    debouncedSync(d.position, d.is_paused, d.updatedAt);
    initialSync = null;
  }
}

function debouncedSync(pos, isPaused, serverTs) {
  if (syncTimeout) clearTimeout(syncTimeout);
  syncTimeout = setTimeout(() => doSync(pos, isPaused, serverTs), 50);
}

// 4) основная синхронизация
function doSync(pos, isPaused, serverTs) {
  if (serverTs <= lastUpdate) return;
  lastUpdate = serverTs;
  if (!player) return;

  isRemoteAction = true;
  const now    = Date.now();
  const drift = (now - serverTs) - lastPing/2;
  const target= isPaused ? pos : pos + drift/1000;
  const delta = target - player.currentTime;
  const absD  = Math.abs(delta);

  // если далеко ушли — запросим fresh-state
  if (absD > AUTO_RESYNC_THRESHOLD) {
    socket.emit('request_state', { roomId });
  }

  // прыжок
  if (absD > HARD_SYNC_THRESHOLD) {
    player.currentTime = target;
  }
  // плавная подстройка
  else if (!isPaused && absD > SOFT_SYNC_THRESHOLD) {
    player.playbackRate = Math.min(1.5, Math.max(0.5, 1 + delta * 0.5));
  }
  else if (player.playbackRate !== 1) {
    player.playbackRate = 1;
  }

  // пауза/плей
  if (isPaused && !player.paused) {
    player.pause();
  } else if (!isPaused && player.paused) {
    player.play().catch(()=>{});
  }

  // сбрасываем remote-режим
  setTimeout(() => {
    isRemoteAction = false;
    if (player.playbackRate !== 1) player.playbackRate = 1;
  }, 100);
}

// 5) грузим комнату и инициализируем плеер
async function fetchRoom() {
  try {
    const res = await fetch(`${BACKEND}/api/rooms/${roomId}`);
    if (!res.ok) throw new Error(res.status);
    const { movie_id } = await res.json();
    const movie = movies.find(m=>m.id===movie_id);
    if (!movie?.videoUrl) throw new Error('Фильм не найден');
    backLink.href = `${movie.html}?id=${movie.id}`;

    playerWrapper.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.style.position = 'relative';
    wrap.innerHTML = `
      <video id="videoPlayer" controls muted playsinline crossorigin="anonymous"
             style="width:100%;border-radius:14px"></video>
    `;
    spinner = createSpinner();
    wrap.appendChild(spinner);
    playerWrapper.appendChild(wrap);

    // бейдж комнаты
    const badge = document.createElement('div');
    badge.className = 'room-id-badge';
    badge.innerHTML = `
      <small>ID комнаты:</small><code>${roomId}</code>
      <button id="copyRoomId">Копировать</button>
    `;
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
      v.addEventListener('waiting',  ()=>spinner.style.display='block');
      v.addEventListener('playing', ()=>spinner.style.display='none');
    } else if (v.canPlayType('application/vnd.apple.mpegurl')) {
      v.src = movie.videoUrl;
    } else throw new Error('HLS не поддерживается');

    v.addEventListener('loadedmetadata', ()=>{
      metadataReady = true;
      if (initialSync) {
        doSync(initialSync.position, initialSync.is_paused, initialSync.updatedAt);
        initialSync = null;
      }
    });

    v.addEventListener('seeking', ()=>{
      if (!isRemoteAction) {
        localSeeking = true;
        wasPlayingBeforeSeek = !v.paused;
      }
    });

    v.addEventListener('seeked', ()=>{
      if (!isRemoteAction) {
        // после seek бросаем синхронизацию
        emitReliableAction();
        if (wasPlayingBeforeSeek) {
          v.play().catch(()=>{});
        } else {
          v.pause();
        }
      }
    });

    v.addEventListener('play', ()=>{
      if (!isRemoteAction) emitReliableAction();
    });
    v.addEventListener('pause', ()=>{
      if (!isRemoteAction) emitReliableAction();
    });

    player = v;
  } catch(err) {
    console.error(err);
    playerWrapper.innerHTML = `<p class="error">Ошибка: ${err.message}</p>`;
  }
}

// 6) надёжный эмит — тройной рестарт
function emitReliableAction() {
  const data = {
    roomId,
    position:  player.currentTime,
    is_paused: player.paused,
    speed:     player.playbackRate
  };
  [0,100,200].forEach(dt =>
    setTimeout(()=>socket.emit('player_action', data), dt)
  );
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
