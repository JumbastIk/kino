// room.js

const BACKEND = (location.hostname.includes('localhost'))
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

// DOM-элементы
const playerWrapper = document.getElementById('playerWrapper');
const backLink      = document.getElementById('backLink');
const messagesBox   = document.getElementById('messages');
const membersList   = document.getElementById('membersList');
const msgInput      = document.getElementById('msgInput');
const sendBtn       = document.getElementById('sendBtn');

let player, blocker;
let ownerId     = null;
let iAmOwner    = false;
let myUserId    = null;
let controlsLocked = false;  // флаг, запрещающий зрителям переключать

// === Помощники ===

// Обновляем ownerId и флаг iAmOwner
function updateOwnerState(newOwnerId) {
  ownerId   = newOwnerId || ownerId;
  iAmOwner  = (myUserId === ownerId);
}

// Посылаем событие владельца
function emitPlayerAction(isPaused) {
  socket.emit('player_action', {
    roomId,
    position:  player.currentTime,
    is_paused: isPaused,
    speed:     player.playbackRate,
    updatedAt: Date.now(),
    userId:    myUserId
  });
}

// === Socket.io ===

socket.on('connect', () => {
  myUserId = socket.id;
  socket.emit('join',         { roomId, userData: { id: myUserId, first_name: 'Гость' } });
  socket.emit('request_state',{ roomId });
  fetchRoom();
});

// получать список участников
socket.on('members', ms => {
  membersList.innerHTML =
    `<div class="chat-members-label">Участники (${ms.length}):</div>
     <ul>${ms.map(m=>`<li>${m.user_id}</li>`).join('')}</ul>`;
});

// чат
socket.on('history', data => {
  messagesBox.innerHTML = '';
  data.forEach(m=>appendMessage(m.author,m.text));
});
socket.on('chat_message', m => appendMessage(m.author,m.text));
socket.on('system_message', m => m.text && appendSystemMessage(m.text));

sendBtn.addEventListener('click', sendMessage);
msgInput.addEventListener('keydown', e => { if(e.key==='Enter') sendMessage(); });
function sendMessage(){
  const t = msgInput.value.trim();
  if (!t) return;
  socket.emit('chat_message', { roomId, author:'Гость', text:t });
  msgInput.value = '';
}

// синхронизация состояния
socket.on('sync_state', d => applySync(d));
socket.on('player_update', d => applySync(d));

function applySync({ position, is_paused, speed, updatedAt, owner_id }) {
  updateOwnerState(owner_id);
  if (!player) return;
  // воспроизводим/паузим и seek
  player.currentTime  = position;
  player.playbackRate = speed;
  if (is_paused) player.pause();
  else           player.play().catch(()=>{});
}

// получаем событие блокировки
socket.on('controls_locked', locked => {
  controlsLocked = locked;
  if (!player) return;
  if (!iAmOwner) {
    // зрителям: скрыть HUD и блокировать клики
    player.controls = false;
    blocker.style.display = 'block';
  } else {
    // owner: всегда имеет HUD
    player.controls = true;
    blocker.style.display = 'none';
  }
});

// смена владельца
socket.on('owner_changed', newOwnerId => {
  updateOwnerState(newOwnerId);
  // если только что стали owner, снять блокировку HUD
  if (iAmOwner) {
    player.controls = true;
    blocker.style.display = 'none';
  }
});

// === Инициализация комнаты и плеера ===

async function fetchRoom(){
  // получить комнату и movie
  const res = await fetch(`${BACKEND}/api/rooms/${roomId}`);
  const roomData = await res.json();
  updateOwnerState(roomData.owner_id);

  // создать UI
  backLink.href = `${roomData.movie_html || 'index.html'}?id=${roomData.movie_id}`;
  playerWrapper.innerHTML = '';

  // контейнер для video + blocker
  const wrap = document.createElement('div');
  wrap.style.position = 'relative';
  wrap.innerHTML = `<video id="videoPlayer" controls playsinline style="width:100%"></video>`;
  blocker = document.createElement('div');
  Object.assign(blocker.style, {
    position:'absolute', top:0, left:0,
    width:'100%', height:'100%',
    background:'rgba(0,0,0,0)',
    display:'none',
    pointerEvents:'all'
  });
  wrap.appendChild(blocker);
  playerWrapper.appendChild(wrap);

  // кнопка блокировки для owner-а
  if (iAmOwner) {
    const ctrl = document.createElement('label');
    ctrl.innerHTML = `
      <input type="checkbox" id="toggleLock" ${controlsLocked?'checked':''}/>
      Запретить переключение зрителям
    `;
    playerWrapper.prepend(ctrl);
    ctrl.querySelector('#toggleLock').addEventListener('change', e => {
      controlsLocked = e.target.checked;
      socket.emit('toggle_controls', { roomId, locked: controlsLocked });
      // локально применяем owner-у
      player.controls = true;
      blocker.style.display = 'none';
    });
  }

  // инициализировать видео (HLS или прямой src)
  player = document.getElementById('videoPlayer');
  const movie = movies.find(m=>m.id===roomData.movie_id);
  if (window.Hls?.isSupported()) {
    const hls = new Hls();
    hls.loadSource(movie.videoUrl);
    hls.attachMedia(player);
  } else {
    player.src = movie.videoUrl;
  }

  // слушатели play/pause/seek
  player.addEventListener('play', () => {
    if (!iAmOwner && controlsLocked) {
      player.pause();
    } else if (iAmOwner) {
      emitPlayerAction(false);
    }
  });
  player.addEventListener('pause', () => {
    if (!iAmOwner && controlsLocked) {
      player.play();
    } else if (iAmOwner) {
      emitPlayerAction(true);
    }
  });
  player.addEventListener('seeked', () => {
    if (!iAmOwner && controlsLocked) {
      socket.emit('request_state', { roomId });
    } else if (iAmOwner) {
      emitPlayerAction(player.paused);
    }
  });
}

// === UI helpers ===

function appendMessage(author, text) {
  const d = document.createElement('div');
  d.className = 'chat-message';
  d.innerHTML = `<strong>${author}:</strong> ${text}`;
  messagesBox.appendChild(d);
  messagesBox.scrollTop = messagesBox.scrollHeight;
}

function appendSystemMessage(text) {
  const d = document.createElement('div');
  d.className = 'chat-message system-message';
  d.innerHTML = `<em>${text}</em>`;
  messagesBox.appendChild(d);
  messagesBox.scrollTop = messagesBox.scrollHeight;
}
