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
let isRemoteAction = false;
let lastUpdate     = 0;
let lastPing       = 0;
let myUserId       = null;
let initialSync    = null;

// пороги синхронизации
const HARD_SYNC_THRESHOLD   = 0.3;  // сек — мгновенный перепрыг
const SOFT_SYNC_THRESHOLD   = 0.05; // сек — подтяжка через playbackRate
const AUTO_RESYNC_THRESHOLD = 1.0;  // сек — если больше, запросим свежий стейт

// ==========================
// 1) меряем RTT для drift-коррекции
// ==========================
function measurePing() {
  const t0 = Date.now();
  socket.emit('ping');
  socket.once('pong', () => {
    lastPing = Date.now() - t0;
  });
}
setInterval(measurePing, 10_000);

// ==========================
// 2) при connect запрашиваем комнату и состояние
// ==========================
socket.on('connect', () => {
  myUserId = socket.id;
  socket.emit('join',          { roomId, userData: { id: myUserId, first_name: 'Гость' } });
  socket.emit('request_state', { roomId });
  fetchRoom();
});

// ==========================
// 3) чат и участники (без изменений)
// ==========================
socket.on('members', ms => {
  membersList.innerHTML =
    `<div class="chat-members-label">Участники (${ms.length}):</div>` +
    `<ul>${ms.map(m=>`<li>${m.user_id}</li>`).join('')}</ul>`;
});
socket.on('history', data => {
  messagesBox.innerHTML = '';
  data.forEach(m => appendMessage(m.author, m.text));
});
socket.on('chat_message',   m => appendMessage(m.author, m.text));
socket.on('system_message', msg => msg?.text && appendSystemMessage(msg.text));
sendBtn.addEventListener('click', sendMessage);
msgInput.addEventListener('keydown', e => e.key==='Enter' && sendMessage());
function sendMessage() {
  const t = msgInput.value.trim();
  if (!t) return;
  socket.emit('chat_message', { roomId, author:'Гость', text:t });
  msgInput.value = '';
}

// ==========================
// 4) входящие обновления сразу применяем
// ==========================
socket.on('sync_state',   d => { initialSync = d; });
socket.on('player_update', d => {
  doSync(d.position, d.is_paused, d.updatedAt);
});

// ==========================
// 5) основная синхронизация
// ==========================
function doSync(pos, isPaused, serverTs) {
  if (serverTs <= lastUpdate) return;
  lastUpdate = serverTs;
  if (!player) return;

  isRemoteAction = true;
  const now     = Date.now();
  const driftMs = (now - serverTs) - lastPing/2;
  const target  = isPaused ? pos : pos + driftMs/1000;
  const delta   = target - player.currentTime;
  const absD    = Math.abs(delta);

  // если очень большой рассинхрон — запросим у сервера свежий стейт
  if (absD > AUTO_RESYNC_THRESHOLD) {
    socket.emit('request_state', { roomId });
  }

  // 1) большой рассинхрон — мгновенный перепрыг
  if (absD > HARD_SYNC_THRESHOLD) {
    player.currentTime = target;
  }
  // 2) средний — подтягиваем скоростью
  else if (absD > SOFT_SYNC_THRESHOLD && !isPaused) {
    player.playbackRate = Math.min(1.5, Math.max(0.5, 1 + delta * 0.5));
  }
  // 3) иначе — возвращаем нормальную скорость
  else if (player.playbackRate !== 1) {
    player.playbackRate = 1;
  }

  // 4) play/pause точно по серверному флагу
  if (isPaused && !player.paused)      player.pause();
  else if (!isPaused && player.paused) player.play().catch(()=>{});

  // ждём, пока все внутренние события отработают
  setTimeout(() => {
    isRemoteAction = false;
    if (player.playbackRate !== 1) player.playbackRate = 1;
  }, 500);
}

// ==========================
// 6) загрузка комнаты и инициализация плеера
// ==========================
async function fetchRoom(){
  try {
    const res = await fetch(`${BACKEND}/api/rooms/${roomId}`);
    if (!res.ok) throw new Error(res.status);
    const { movie_id } = await res.json();
    const movie = movies.find(m => m.id === movie_id);
    if (!movie || !movie.videoUrl) throw new Error('Фильм не найден');
    backLink.href = `${movie.html}?id=${movie.id}`;

    playerWrapper.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.style.position = 'relative';
    wrap.innerHTML = `
      <video id="videoPlayer" controls autoplay muted playsinline crossorigin="anonymous"
             style="width:100%;border-radius:14px"></video>
    `;
    const spinner = createSpinner();
    wrap.appendChild(spinner);
    playerWrapper.appendChild(wrap);

    // секция с ID комнаты
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

    // HLS
    if (window.Hls?.isSupported()) {
      const hls = new Hls();
      hls.loadSource(movie.videoUrl);
      hls.attachMedia(v);
      v.addEventListener('waiting',  () => spinner.style.display = 'block');
      v.addEventListener('playing', () => spinner.style.display = 'none');
    } else if (v.canPlayType('application/vnd.apple.mpegurl')) {
      v.src = movie.videoUrl;
    } else {
      throw new Error('HLS не поддерживается');
    }

    // initial sync после загрузки метаданных
    v.addEventListener('loadedmetadata', () => {
      if (initialSync) {
        doSync(initialSync.position, initialSync.is_paused, initialSync.updatedAt);
        initialSync = null;
      }
    });

    // ========== события пользователя ==========
    // фильтруем только реальные клики/драги
    v.addEventListener('seeking', e => {
      if (!e.isTrusted || isRemoteAction) return;
    });
    v.addEventListener('seeked', e => {
      if (!e.isTrusted || isRemoteAction) return;
      emitReliableAction();
    });
    v.addEventListener('play', e => {
      if (!e.isTrusted || isRemoteAction) return;
      emitReliableAction();
    });
    v.addEventListener('pause', e => {
      if (!e.isTrusted || isRemoteAction) return;
      emitReliableAction();
    });

    player = v;

  } catch(err) {
    console.error(err);
    playerWrapper.innerHTML = `<p class="error">Ошибка: ${err.message}</p>`;
  }
}

// отправляем сразу и с автоповторами, чтобы не терять команды при частых seeks
function emitReliableAction() {
  const data = {
    roomId,
    position:  player.currentTime,
    is_paused: player.paused,
    speed:     player.playbackRate
  };
  for (let delay of [0, 100, 200]) {
    setTimeout(() => socket.emit('player_action', data), delay);
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
