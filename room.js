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

const playerWrapper = document.getElementById('playerWrapper');
const backLink      = document.getElementById('backLink');
const messagesBox   = document.getElementById('messages');
const membersList   = document.getElementById('membersList');
const msgInput      = document.getElementById('msgInput');
const sendBtn       = document.getElementById('sendBtn');

let player, blocker;
let isSeeking = false, isRemoteAction = false;
let lastUpdate = 0;
let ownerId = null;
let iAmOwner = false;
let myUserId = null;
let initialSync = null;
let syncTimeout = null;
let controlsLocked = false;  // глобальный флаг блокировки управления

// --- Функция для обновления owner_id в базе через бекенд ---
async function setOwnerIdInDb(roomId, ownerId) {
  try {
    await fetch(`${BACKEND}/api/rooms/${roomId}/set_owner`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner_id: ownerId })
    });
  } catch (err) {
    console.warn('[setOwnerIdInDb] Не удалось обновить owner_id в БД:', err);
  }
}

function updateOwnerState(newOwnerId) {
  if (newOwnerId) {
    ownerId = newOwnerId;
  } else if (!ownerId && myUserId) {
    ownerId = myUserId;
    setOwnerIdInDb(roomId, ownerId);
  }
  iAmOwner = (myUserId === ownerId);
}

// --- Отправка действий владельца ---
function emitPlayerAction(paused) {
  socket.emit('player_action', {
    roomId,
    position:  player.currentTime,
    is_paused: paused,
    speed:     player.playbackRate,
    updatedAt: Date.now(),
    userId:    myUserId
  });
}

// --- Присоединяемся и запрашиваем состояние ---
socket.on('connect', () => {
  myUserId = socket.id;
  socket.emit('join', { roomId, userData: { id: myUserId, first_name: 'Гость' } });
  socket.emit('request_state', { roomId });
  fetchRoom();
});

// === Участники комнаты ===
socket.on('members', members => {
  membersList.innerHTML =
    `<div class="chat-members-label">Участники (${members.length}):</div>
     <ul>${members.map(m => `<li>${m.user_id}</li>`).join('')}</ul>`;
});

// =========== Чат ===========
socket.on('history', data => {
  messagesBox.innerHTML = '';
  data.forEach(m => appendMessage(m.author, m.text));
});
socket.on('chat_message', m => appendMessage(m.author, m.text));
socket.on('system_message', msg => {
  if (msg?.text) appendSystemMessage(msg.text);
});
sendBtn.addEventListener('click', sendMessage);
msgInput.addEventListener('keydown', e => e.key === 'Enter' && sendMessage());
function sendMessage() {
  const text = msgInput.value.trim();
  if (!text) return;
  socket.emit('chat_message', { roomId, author: 'Гость', text });
  msgInput.value = '';
}

// --- Дебаунс для sync
function debouncedSync(position, is_paused, updatedAt, owner_id) {
  if (syncTimeout) clearTimeout(syncTimeout);
  syncTimeout = setTimeout(() => {
    syncPlayer(position, is_paused, updatedAt, owner_id);
  }, 100);
}

// Собственно синхронизация
function syncPlayer(position, is_paused, updatedAt, owner_id) {
  updateOwnerState(owner_id);
  // обновляем состояние блокировки
  blocker.style.display = iAmOwner || !controlsLocked ? 'none' : 'block';
  player.controls      = iAmOwner || !controlsLocked;

  if (updatedAt < lastUpdate) return;
  lastUpdate = updatedAt;
  if (!player) return;

  isRemoteAction = true;

  if (Math.abs(player.currentTime - position) > 0.7 && player.readyState > 0) {
    player.currentTime = position;
  }
  if (is_paused && !player.paused) {
    player.pause();
  }
  if (!is_paused && player.paused) {
    player.play().catch(() => {
      if (!window.__autoplayWarned) {
        window.__autoplayWarned = true;
        alert('Разрешите автозапуск, кликнув по видео.');
      }
    });
  }
  setTimeout(() => isRemoteAction = false, 120);
}

// Слушаем sync_state и player_update
socket.on('sync_state', data => {
  if (!player) {
    initialSync = data;
  } else {
    debouncedSync(data.position, data.is_paused, data.updatedAt, data.owner_id);
  }
});
socket.on('player_update', data => {
  debouncedSync(data.position, data.is_paused, data.updatedAt, data.owner_id);
});

// Обработка события блокировки от owner-а
socket.on('controls_locked', locked => {
  controlsLocked = locked;
  if (player) {
    blocker.style.display = !iAmOwner && controlsLocked ? 'block' : 'none';
    player.controls      = iAmOwner || !controlsLocked;
  }
});

// --- Инициализация плеера и UI ---
async function fetchRoom() {
  try {
    const res = await fetch(`${BACKEND}/api/rooms/${roomId}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const roomData = await res.json();

    updateOwnerState(roomData.owner_id);
    if (!roomData.owner_id && myUserId) {
      await setOwnerIdInDb(roomId, myUserId);
      ownerId = myUserId;
      iAmOwner = true;
    }

    const movie = movies.find(m => m.id === roomData.movie_id);
    if (!movie?.videoUrl) throw new Error('Фильм не найден');
    backLink.href = `${movie.html}?id=${movie.id}`;

    // Контейнер для видео + блокера
    playerWrapper.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.style.position = 'relative';
    wrap.innerHTML = `
      <video id="videoPlayer" controls crossorigin="anonymous" playsinline
             style="width:100%; border-radius:14px"></video>
    `;
    const spinner = createSpinner();
    wrap.appendChild(spinner);
    blocker = document.createElement('div');
    blocker.id = 'blocker';
    Object.assign(blocker.style, {
      position: 'absolute',
      top: '0', left: '0',
      width: '100%', height: '100%',
      background: 'rgba(0,0,0,0)',
      pointerEvents: 'all',
      display: (!iAmOwner && controlsLocked) ? 'block' : 'none'
    });
    wrap.appendChild(blocker);
    playerWrapper.appendChild(wrap);

    // Badge и копирование ID
    const badge = document.createElement('div');
    badge.className = 'room-id-badge';
    badge.innerHTML = `
      <small>ID комнаты:</small>
      <code>${roomId}</code>
      <button id="copyRoomId">Копировать</button>
    `;
    playerWrapper.after(badge);
    document.getElementById('copyRoomId').onclick = () => {
      navigator.clipboard.writeText(roomId);
      alert('ID комнаты скопирован');
    };

    // Кнопка блокировки управления (только owner)
    if (iAmOwner) {
      const ctrlDiv = document.createElement('div');
      ctrlDiv.style.margin = '8px 0';
      ctrlDiv.innerHTML = `
        <label>
          <input type="checkbox" id="toggleLock" ${controlsLocked ? 'checked' : ''}/>
          Запретить переключение зрителям
        </label>
      `;
      badge.after(ctrlDiv);
      document.getElementById('toggleLock').addEventListener('change', e => {
        controlsLocked = e.target.checked;
        // шлём всем в комнате
        socket.emit('toggle_controls', { roomId, locked: controlsLocked });
        // применяем сразу локально
        blocker.style.display = controlsLocked ? 'block' : 'none';
        player.controls      = !controlsLocked;
      });
    }

    const v = document.getElementById('videoPlayer');
    let hls = null;

    if (window.Hls?.isSupported()) {
      hls = new Hls({ debug: false });
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

    v.addEventListener('loadedmetadata', () => {
      if (initialSync) {
        syncPlayer(initialSync.position, initialSync.is_paused, initialSync.updatedAt, initialSync.owner_id);
        initialSync = null;
      }
    });

    // Слушатели play/pause/seek
    v.addEventListener('play', () => {
      if (!iAmOwner && controlsLocked) {
        v.pause();
        return;
      }
      if (iAmOwner && !isRemoteAction) emitPlayerAction(false);
    });
    v.addEventListener('pause', () => {
      if (!iAmOwner && controlsLocked) {
        v.play();
        return;
      }
      if (iAmOwner && !isRemoteAction) emitPlayerAction(true);
    });
    v.addEventListener('seeking', () => { isSeeking = true; });
    v.addEventListener('seeked', () => {
      if (!iAmOwner && controlsLocked) {
        // вернёмся назад, если зритель пытался
        syncPlayer(lastUpdatePos, !player.paused, lastUpdate, ownerId);
      }
      if (iAmOwner && !isRemoteAction) {
        emitPlayerAction(player.paused);
      }
      setTimeout(() => isSeeking = false, 120);
    });

    player = v;
  } catch (err) {
    console.error('[ERROR] Ошибка комнаты:', err);
    playerWrapper.innerHTML = `<p class="error">Ошибка: ${err.message}</p>`;
  }
}

// От сервера: обновление флага блокировки
socket.on('controls_locked', locked => {
  controlsLocked = locked;
  if (blocker && player) {
    blocker.style.display = (!iAmOwner && controlsLocked) ? 'block' : 'none';
    player.controls      = iAmOwner || !controlsLocked;
  }
});

// При смене владельца
socket.on('owner_changed', newOwnerId => {
  updateOwnerState(newOwnerId);
});

function createSpinner() {
  const s = document.createElement('div');
  s.className = 'buffer-spinner';
  s.innerHTML = `
    <div class="double-bounce1"></div>
    <div class="double-bounce2"></div>
  `;
  s.style.display = 'none';
  return s;
}

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
