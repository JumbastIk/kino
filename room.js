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
let metadataReady  = false;

// thresholds
const HARD_SYNC_THRESHOLD   = 0.3;  // seconds – jump
const SOFT_SYNC_THRESHOLD   = 0.05; // seconds – rate adjust
const AUTO_RESYNC_THRESHOLD = 1.0;  // seconds – force request_state

// 1) measure RTT
function measurePing() {
  const t0 = Date.now();
  socket.emit('ping');
  socket.once('pong', () => {
    lastPing = Date.now() - t0;
  });
}
setInterval(measurePing, 10_000);

// 2) on connect request state
socket.on('connect', () => {
  myUserId = socket.id;
  socket.emit('join',          { roomId, userData: { id: myUserId, first_name: 'Гость' } });
  socket.emit('request_state', { roomId });
  fetchRoom();
});
socket.on('reconnect', () => {
  socket.emit('request_state', { roomId });
});

// 3) chat and members
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

// 4) incoming sync
socket.on('sync_state', d => {
  initialSync = d;
  if (metadataReady) {
    doSync(d.position, d.is_paused, d.updatedAt);
    initialSync = null;
  }
});
socket.on('player_update', d => {
  doSync(d.position, d.is_paused, d.updatedAt);
});

// 5) main sync logic
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

  if (absD > AUTO_RESYNC_THRESHOLD) {
    socket.emit('request_state', { roomId });
  }

  if (absD > HARD_SYNC_THRESHOLD) {
    player.currentTime = target;
  }
  else if (absD > SOFT_SYNC_THRESHOLD && !isPaused) {
    player.playbackRate = Math.min(1.5, Math.max(0.5, 1 + delta * 0.5));
  }
  else if (player.playbackRate !== 1) {
    player.playbackRate = 1;
  }

  if (isPaused && !player.paused)      player.pause();
  else if (!isPaused && player.paused) player.play().catch(()=>{});

  // out-of-sync indicator
  const overlay = document.getElementById('outOfSync');
  if (absD > AUTO_RESYNC_THRESHOLD) overlay.style.display = 'block';
  else overlay.style.display = 'none';

  setTimeout(() => {
    isRemoteAction = false;
    if (player.playbackRate !== 1) player.playbackRate = 1;
  }, 500);
}

// 6) load room & init player + custom controls
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
      <video id="videoPlayer" playsinline muted crossorigin="anonymous"
             style="width:100%;border-radius:14px; background:#000;"></video>
      <div id="customControls" class="custom-controls">
        <button id="btnPlay" class="control-btn">Play</button>
        <input id="seekBar" type="range" class="seek-bar" min="0" max="100" value="0">
        <span id="timeDisplay" class="time-display">00:00 / 00:00</span>
        <button id="btnResync" class="control-btn" style="display:none;">Resync</button>
      </div>
      <div id="outOfSync" class="out-of-sync" style="display:none;">
        Видео рассинхронизировалось! <button id="btnManualResync">Синхронизировать</button>
      </div>
    `;
    playerWrapper.appendChild(wrap);

    // room ID badge
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
    const playBtn = document.getElementById('btnPlay');
    const seekBar = document.getElementById('seekBar');
    const timeDisp = document.getElementById('timeDisplay');
    const manualBtn = document.getElementById('btnManualResync');

    // HLS setup
    if (window.Hls?.isSupported()) {
      const hls = new Hls();
      hls.loadSource(movie.videoUrl);
      hls.attachMedia(v);
      v.addEventListener('waiting',  () => wrap.querySelector('.buffer-spinner').style.display = 'block');
      v.addEventListener('playing', () => wrap.querySelector('.buffer-spinner').style.display = 'none');
    } else if (v.canPlayType('application/vnd.apple.mpegurl')) {
      v.src = movie.videoUrl;
    } else {
      throw new Error('HLS не поддерживается');
    }

    // metadata loaded
    v.addEventListener('loadedmetadata', () => {
      metadataReady = true;
      seekBar.max = v.duration;
      updateTimeDisplay();
      if (initialSync) {
        v.pause();
        doSync(initialSync.position, initialSync.is_paused, initialSync.updatedAt);
        initialSync = null;
      }
    });

    // update seek/time
    v.addEventListener('timeupdate', () => {
      if (!isRemoteAction) {
        seekBar.value = v.currentTime;
        updateTimeDisplay();
      }
    });
    function updateTimeDisplay() {
      const fmt = t => {
        const m = Math.floor(t/60), s = Math.floor(t%60);
        return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
      };
      timeDisp.textContent = `${fmt(v.currentTime)} / ${fmt(v.duration)}`;
    }

    // custom controls events
    playBtn.onclick = () => {
      if (v.paused) v.play(); else v.pause();
    };
    seekBar.oninput = () => {
      v.currentTime = seekBar.value;
      updateTimeDisplay();
    };
    seekBar.onchange = () => {
      emitReliableAction();
    };
    manualBtn.onclick = () => {
      socket.emit('request_state', { roomId });
    };

    // filter user events
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
      playBtn.textContent = 'Pause';
    });
    v.addEventListener('pause', e => {
      if (!e.isTrusted || isRemoteAction) return;
      emitReliableAction();
      playBtn.textContent = 'Play';
    });

    player = v;
  } catch(err) {
    console.error(err);
    playerWrapper.innerHTML = `<p class="error">Ошибка: ${err.message}</p>`;
  }
}

// reliable action emitter
function emitReliableAction() {
  const data = {
    roomId,
    position:  player.currentTime,
    is_paused: player.paused,
    speed:     player.playbackRate
  };
  [0,100,200].forEach(d => setTimeout(() => socket.emit('player_action', data), d));
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
