// room.js

// 0) Подключите в <head> страницы:
// <script src="https://unpkg.com/mqtt/dist/mqtt.min.js"></script>

const BACKEND = location.hostname.includes('localhost')
  ? 'http://localhost:3000'
  : 'https://kino-fhwp.onrender.com';

// Socket.io для чата и списка участников
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

let player, spinner, mqttClient;
let isRemoteAction = false;
let lastUpdate     = 0;
let lastPing       = 0;
let myUserId       = null;
let initialSync    = null;
let metadataReady  = false;

// пороги
const HARD_SYNC_THRESHOLD   = 0.3;
const SOFT_SYNC_THRESHOLD   = 0.05;
const AUTO_RESYNC_THRESHOLD = 1.0;

// 1) Меряем RTT по Socket.io
function measurePing() {
  const t0 = Date.now();
  socket.emit('ping');
  socket.once('pong', () => {
    lastPing = Date.now() - t0;
  });
}
setInterval(measurePing, 10_000);

// 2) Socket.io: чат + участники, затем стартуем MQTT и UI
socket.on('connect', () => {
  myUserId = socket.id;
  socket.emit('join', { roomId, userData: { id: myUserId, first_name: 'Гость' } });
  initMQTT();
  fetchRoom();
});

// чат и список участников
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

// 3) Инициализация MQTT (QoS 2, retain, persistent session)
function initMQTT() {
  mqttClient = mqtt.connect('wss://broker.hivemq.com:8884/mqtt', {
    clientId:     `client_${myUserId}`,
    clean:        false,      // persistent session
    reconnectPeriod: 1000,
    connectTimeout: 4000
  });

  mqttClient.on('connect', () => {
    // подписываемся на retained-тему с QoS 2
    mqttClient.subscribe(`video/${roomId}`, { qos: 2 }, () => {
      // сразу шлём свой state
      publishState();
    });
  });

  mqttClient.on('message', (_, payload) => {
    try {
      const msg = JSON.parse(payload.toString());
      if (msg.roomId !== roomId) return;
      if (msg.userId === myUserId) return;
      initialSync = msg;
      if (metadataReady) {
        doSync(msg.position, msg.isPaused, msg.ts);
        initialSync = null;
      }
    } catch {}
  });
}

// 4) Основная sync-логика
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

  if (absD > AUTO_RESYNC_THRESHOLD) publishState();
  if (absD > HARD_SYNC_THRESHOLD) {
    player.currentTime = target;
  } else if (absD > SOFT_SYNC_THRESHOLD && !isPaused) {
    player.playbackRate = Math.min(1.5, Math.max(0.5, 1 + delta * 0.5));
  } else if (player.playbackRate !== 1) {
    player.playbackRate = 1;
  }

  if (isPaused && !player.paused)      player.pause();
  else if (!isPaused && player.paused) player.play().catch(()=>{});

  setTimeout(() => {
    isRemoteAction = false;
    if (player.playbackRate !== 1) player.playbackRate = 1;
  }, 500);
}

// 5) Публикация state в MQTT
function publishState() {
  if (!mqttClient || !player) return;
  const msg = {
    roomId,
    userId:   myUserId,
    position: player.currentTime,
    isPaused: player.paused,
    speed:    player.playbackRate,
    ts:       Date.now()
  };
  mqttClient.publish(`video/${roomId}`, JSON.stringify(msg), { qos: 2, retain: true });
}

// 6) Загрузка комнаты + UI + плеер
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
      <video id="videoPlayer" playsinline muted crossorigin="anonymous"
             style="width:100%;border-radius:14px;background:#000"></video>
      <div class="custom-controls">
        <button id="btnPlay" class="control-btn">Play</button>
        <input  id="seekBar" type="range" class="seek-bar" min="0" max="100" value="0">
        <span   id="timeDisplay" class="time-display">00:00 / 00:00</span>
      </div>
    `;
    spinner = createSpinner();
    wrap.appendChild(spinner);
    playerWrapper.appendChild(wrap);

    // бейдж комнаты
    const badge = document.createElement('div');
    badge.className = 'room-id-badge';
    badge.innerHTML = `
      <small>ID комнаты:</small><code>${roomId}</code>
      <button id="copyRoomId">Копировать</button>`;
    playerWrapper.after(badge);
    document.getElementById('copyRoomId').onclick = ()=>{
      navigator.clipboard.writeText(roomId);
      alert('Скопировано');
    };

    const v       = document.getElementById('videoPlayer');
    const playBtn = document.getElementById('btnPlay');
    const seekBar = document.getElementById('seekBar');
    const timeDisp= document.getElementById('timeDisplay');

    // HLS
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

    // метаданные
    v.addEventListener('loadedmetadata', ()=>{
      metadataReady = true;
      seekBar.max = v.duration;
      updateTimeDisplay();
      if (initialSync) {
        v.pause();
        doSync(initialSync.position, initialSync.isPaused, initialSync.ts);
        initialSync = null;
      }
    });

    // апдейт прогресса
    v.addEventListener('timeupdate', ()=>{
      if (!isRemoteAction) {
        seekBar.value = v.currentTime;
        updateTimeDisplay();
      }
    });
    function updateTimeDisplay(){
      const fmt = t=> {
        const m = Math.floor(t/60), s = Math.floor(t%60);
        return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
      };
      timeDisp.textContent = `${fmt(v.currentTime)} / ${fmt(v.duration)}`;
    }

    // custom controls
    playBtn.onclick = ()=>{
      if (v.paused) v.play(); else v.pause();
      publishState();
    };
    seekBar.oninput = ()=>{
      v.currentTime = seekBar.value;
      updateTimeDisplay();
    };
    seekBar.onchange = ()=>publishState();

    // фильтрация нативных событий
    ['seeked','play','pause'].forEach(evt=>{
      v.addEventListener(evt, e=>{
        if (!e.isTrusted || isRemoteAction) return;
        publishState();
      });
    });

    player = v;
  } catch(err) {
    console.error(err);
    playerWrapper.innerHTML = `<p class="error">Ошибка: ${err.message}</p>`;
  }
}

// — вспомогательные функции —
function createSpinner(){
  const s = document.createElement('div');
  s.className = 'buffer-spinner';
  s.innerHTML = `<div class="double-bounce1"></div><div class="double-bounce2"></div>`;
  s.style.display = 'none';
  return s;
}
function appendMessage(a,t){
  const d = document.createElement('div');
  d.className = 'chat-message';
  d.innerHTML = `<strong>${a}:</strong> ${t}`;
  messagesBox.appendChild(d);
  messagesBox.scrollTop = messagesBox.scrollHeight;
}
function appendSystemMessage(t){
  const d = document.createElement('div');
  d.className = 'chat-message system-message';
  d.innerHTML = `<em>${t}</em>`;
  messagesBox.appendChild(d);
  messagesBox.scrollTop = messagesBox.scrollHeight;
}
