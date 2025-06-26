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
let isRemoteAction = false;
let lastUpdate     = 0;
let lastPing       = 0;
let myUserId       = null;
let initialSync    = null;
let syncTimeout    = null;
let metadataReady  = false;
let sendLock       = false;

// thresholds
const HARD_SYNC_THRESHOLD   = 0.3;  // sec
const SOFT_SYNC_THRESHOLD   = 0.05; // sec
const AUTO_RESYNC_THRESHOLD = 1.0;  // sec

// 1) measure RTT
function measurePing() {
  const t0 = Date.now();
  socket.emit('ping');
  socket.once('pong', () => {
    lastPing = Date.now() - t0;
    console.log('[PING]', lastPing, 'ms');
  });
}
setInterval(measurePing, 10000);

// 2) on connect
socket.on('connect', () => {
  myUserId = socket.id;
  console.log('[SOCKET] connect as', myUserId);
  socket.emit('join',          { roomId, userData: { id: myUserId, first_name: 'Гость' } });
  socket.emit('request_state', { roomId });
  fetchRoom();
});
socket.on('reconnect', () => {
  console.log('[SOCKET] reconnect');
  socket.emit('request_state', { roomId });
});

// 3) chat & members
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
msgInput.addEventListener('keydown', e => { if (e.key==='Enter') sendMessage(); });
function sendMessage() {
  const t = msgInput.value.trim();
  if (!t) return;
  socket.emit('chat_message', { roomId, author:'Гость', text:t });
  msgInput.value = '';
}

// 4) incoming sync
socket.on('sync_state',    d => scheduleSync(d));
socket.on('player_update', d => scheduleSync(d));
function scheduleSync(d) {
  initialSync = d;
  if (metadataReady) {
    clearTimeout(syncTimeout);
    syncTimeout = setTimeout(() => doSync(d), 50);
    initialSync = null;
  }
}

// 5) doSync with logs
function doSync({ position: pos, is_paused: isPaused, updatedAt: serverTs }) {
  console.log('[doSync START]', {
    now: Date.now(),
    serverTs,
    pos,
    isPaused,
    lastUpdate,
    currentTime: player?.currentTime
  });

  if (serverTs <= lastUpdate) {
    console.log('[doSync] skipped due to timestamp', { serverTs, lastUpdate });
    return;
  }
  lastUpdate = serverTs;
  if (!player) return;

  isRemoteAction = true;
  const now    = Date.now();
  const drift = (now - serverTs) - lastPing/2;
  const target= isPaused ? pos : pos + drift/1000;
  const delta = target - player.currentTime;
  const absD  = Math.abs(delta);

  console.log('[doSync] drift, target, delta, absD', { drift, target, delta, absD });

  if (absD > AUTO_RESYNC_THRESHOLD) {
    console.log('[doSync] AUTO_RESYNC_THRESHOLD exceeded → request_state');
    socket.emit('request_state', { roomId });
  }
  if (absD > HARD_SYNC_THRESHOLD) {
    console.log('[doSync] HARD_SYNC_THRESHOLD → jump to', target);
    player.currentTime = target;
  }
  else if (!isPaused && absD > SOFT_SYNC_THRESHOLD) {
    const rate = 1 + delta * 0.5;
    console.log('[doSync] SOFT_SYNC_THRESHOLD → adjust rate to', rate);
    player.playbackRate = rate;
  }
  else if (player.playbackRate !== 1) {
    console.log('[doSync] reset playbackRate to 1');
    player.playbackRate = 1;
  }

  if (isPaused) {
    if (!player.paused) {
      console.log('[doSync] pausing');
      player.pause();
    }
  } else {
    if (player.paused) {
      console.log('[doSync] starting play');
      player.play().catch(()=>{});
    }
  }

  console.log('[doSync END]', {
    currentTime: player.currentTime,
    paused: player.paused,
    playbackRate: player.playbackRate
  });

  setTimeout(() => {
    isRemoteAction = false;
    if (player.playbackRate !== 1) player.playbackRate = 1;
  }, 20);
}

// 6) fetchRoom & init player
async function fetchRoom(){
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
             style="width:100%;border-radius:14px;"></video>
    `;
    spinner = createSpinner();
    wrap.appendChild(spinner);
    playerWrapper.appendChild(wrap);

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
    if (window.Hls?.isSupported()) {
      const hls = new Hls();
      hls.loadSource(movie.videoUrl);
      hls.attachMedia(v);
      v.addEventListener('waiting',  ()=>spinner.style.display='block');
      v.addEventListener('playing', ()=>spinner.style.display='none');
    } else if (v.canPlayType('application/vnd.apple.mpegurl')) {
      v.src = movie.videoUrl;
    } else {
      throw new Error('HLS не поддерживается');
    }

    // remember paused-state before seek
    let preSeekWasPaused = true;
    v.addEventListener('seeking', () => {
      preSeekWasPaused = v.paused;
      console.log('[SEEK] started, wasPaused=', preSeekWasPaused);
    });
    v.addEventListener('seeked', () => {
      console.log('[SEEK] finished, newTime=', v.currentTime);
      if (!isRemoteAction) {
        emitAction(v.paused);
        // если до seek было PLAY — сразу запускаем
        if (!preSeekWasPaused) {
          console.log('[SEEK] restoring play');
          v.play().catch(()=>{});
        }
      }
    });

    v.addEventListener('loadedmetadata', () => {
      metadataReady = true;
      console.log('[VIDEO] loadedmetadata, duration=', v.duration);
      if (initialSync) {
        doSync(initialSync);
        initialSync = null;
      }
    });

    function emitAction(paused) {
      console.log('[EMIT] player_action', {
        position: v.currentTime,
        paused
      });
      if (sendLock) return;
      socket.emit('player_action', {
        roomId,
        position:  v.currentTime,
        is_paused: paused,
        speed:     v.playbackRate
      });
      sendLock = true;
      setTimeout(()=> sendLock = false, 150);
    }

    v.addEventListener('play',  () => {
      if (!isRemoteAction) emitAction(false);
    });
    v.addEventListener('pause', () => {
      if (!isRemoteAction) emitAction(true);
    });

    player = v;

  } catch(err) {
    console.error(err);
    playerWrapper.innerHTML = `<p class="error">Ошибка: ${err.message}</p>`;
  }
}

// helpers
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
