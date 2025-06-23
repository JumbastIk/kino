// room.js

const BACKEND = window.location.hostname.includes('localhost')
  ? 'http://localhost:3000'
  : 'https://kino-fhwp.onrender.com';

console.log('[ROOM] backend:', BACKEND);

// Socket.IO
const socket = io(BACKEND, {
  path: '/socket.io',
  transports: ['websocket']
});

// 1. Получаем ID комнаты из URL
const params = new URLSearchParams(window.location.search);
const roomId = params.get('roomId');
if (!roomId) {
  alert('Не указан ID комнаты.');
  throw new Error('Missing roomId');
}
console.log('[ROOM] roomId =', roomId);

// 2. Селекторы DOM
const playerWrapper = document.getElementById('playerWrapper');
const backLink      = document.getElementById('backLink');
const messagesBox   = document.getElementById('messages');
const membersList   = document.getElementById('membersList');
const msgInput      = document.getElementById('msgInput');
const sendBtn       = document.getElementById('sendBtn');

// 3. Синхронизация плеера
let player = null;
let isSeeking = false;
let isRemoteAction = false;

// 4. WebRTC Push-to-Talk
let localStream = null;
const peers = {};

// 4.1. Добавляем кнопку микрофона
const micBtn = document.createElement('button');
micBtn.textContent = '🎤';
micBtn.className = 'mic-btn';
document.querySelector('.chat-input-wrap').appendChild(micBtn);

// 4.2. Push-to-Talk события
micBtn.addEventListener('mousedown', async () => {
  console.log('[MIC] mousedown — пытаемся получить микрофон');
  if (!localStream) {
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      console.log('[MIC] Получили localStream:', localStream);
      socket.emit('new_peer', { roomId, from: socket.id });
      console.log('[MIC] emitted new_peer');
    } catch (err) {
      console.error('[MIC] не удалось получить микрофон', err);
      return alert('Ошибка доступа к микрофону');
    }
  }
  // Создаём PeerConnection для каждого участника
  const ids = await getPeerIds();
  console.log('[MIC] создаём Peer для IDs:', ids);
  for (const id of ids) {
    if (!peers[id]) {
      await createPeer(id, true);
      console.log(`[MIC] created Peer (offer) -> ${id}`);
    }
  }
});

micBtn.addEventListener('mouseup', () => {
  console.log('[MIC] mouseup — выключаем микрофон');
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
    console.log('[MIC] остановили все треки localStream');
    localStream = null;
    // Закрываем соединения
    for (const id in peers) {
      peers[id].close();
      console.log(`[MIC] closed PeerConnection -> ${id}`);
      delete peers[id];
    }
  }
});

// 4.3. Обработка сигналов WebRTC
socket.on('new_peer', async ({ from }) => {
  console.log('[WEBRTC] new_peer from', from);
  if (from === socket.id || !localStream) return;
  await createPeer(from, false);
  console.log('[WEBRTC] created Peer (answer) ->', from);
});

socket.on('signal', async ({ from, description, candidate }) => {
  console.log('[WEBRTC] signal from', from, { description, candidate });
  let pc = peers[from];
  if (!pc) {
    pc = await createPeer(from, false);
    console.log('[WEBRTC] lazy-created Peer ->', from);
  }
  if (description) {
    await pc.setRemoteDescription(description);
    console.log('[WEBRTC] setRemoteDescription', description.type);
    if (description.type === 'offer') {
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('signal', { to: from, description: pc.localDescription });
      console.log('[WEBRTC] sent answer back to', from);
    }
  }
  if (candidate) {
    await pc.addIceCandidate(candidate);
    console.log('[WEBRTC] added ICE candidate');
  }
});

// 4.4. Создание PeerConnection
async function createPeer(peerId, isOffer) {
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
  });
  peers[peerId] = pc;
  console.log('[WEBRTC] createPeer for', peerId, 'offer?', isOffer);

  if (localStream) {
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    console.log('[WEBRTC] attached localStream tracks');
  }

  pc.onicecandidate = e => {
    if (e.candidate) {
      socket.emit('signal', { to: peerId, candidate: e.candidate });
      console.log('[WEBRTC] onicecandidate -> emitted to', peerId);
    }
  };

  pc.ontrack = e => {
    console.log('[WEBRTC] ontrack from', peerId, e.streams);
    let audio = document.getElementById(`audio_${peerId}`);
    if (!audio) {
      audio = document.createElement('audio');
      audio.id = `audio_${peerId}`;
      audio.autoplay = true;
      document.body.appendChild(audio);
      console.log('[WEBRTC] created <audio> for', peerId);
    }
    audio.srcObject = e.streams[0];
  };

  if (isOffer) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('signal', { to: peerId, description: pc.localDescription });
    console.log('[WEBRTC] created & sent offer to', peerId);
  }

  return pc;
}

// 4.5. Получаем список участников из сервера
async function getPeerIds() {
  const res = await fetch(`${BACKEND}/api/rooms/${roomId}/members`);
  const json = await res.json();
  console.log('[ROOM] members API response', json);
  return json.data
    .map(m => m.user_id)
    .filter(id => id !== socket.id);
}

// 5. Socket.IO: join + sync_state
socket.emit('join', { roomId, userData: { id: socket.id, first_name: 'Гость' } });
console.log('[ROOM] emitted join');
socket.emit('request_state', { roomId });
console.log('[ROOM] emitted request_state');

// 5.1. Уведомление о списке участников
socket.on('members', members => {
  console.log('[ROOM] members update', members);
  membersList.innerHTML = `
    <div class="chat-members-label">Участники (${members.length}):</div>
    <ul>${members.map(m => `<li>${m.user_id}</li>`).join('')}</ul>
  `;
});

// 5.2. История чата и новые сообщения
socket.on('history', data => {
  console.log('[CHAT] history', data);
  messagesBox.innerHTML = '';
  data.forEach(m => appendMessage(m.author, m.text));
});
socket.on('chat_message', m => {
  console.log('[CHAT] new message', m);
  appendMessage(m.author, m.text);
});

// 5.3. Отправка текста
sendBtn.addEventListener('click', sendMessage);
msgInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') sendMessage();
});
function sendMessage() {
  const text = msgInput.value.trim();
  if (!text) return;
  console.log('[CHAT] sendMessage:', text);
  socket.emit('chat_message', { roomId, author: 'Гость', text });
  msgInput.value = '';
}

// 5.4. Синхронизация плеера
socket.on('sync_state', ({ position = 0, is_paused }) => {
  console.log('[PLAYER] sync_state', position, is_paused);
  if (!player) return;
  isRemoteAction = true;
  player.currentTime = position;
  is_paused ? player.pause() : player.play().catch(() => {});
  setTimeout(() => (isRemoteAction = false), 200);
});
socket.on('player_update', ({ position = 0, is_paused }) => {
  console.log('[PLAYER] player_update', position, is_paused);
  if (!player) return;
  isRemoteAction = true;
  isSeeking = true;
  player.currentTime = position;
  is_paused ? player.pause() : player.play().catch(() => {});
  setTimeout(() => {
    isSeeking = false;
    isRemoteAction = false;
  }, 200);
});

// 6. Spinner буферизации
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

// 7. Инициализация плеера и UI
async function fetchRoom() {
  try {
    const res = await fetch(`${BACKEND}/api/rooms/${roomId}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { data: roomData } = await res.json();
    console.log('[ROOM] roomData', roomData);

    // Назад к описанию
    const movie = movies.find(m => m.id === roomData.movie_id);
    if (!movie || !movie.videoUrl) throw new Error('Фильм не найден');
    backLink.href = `movie.html?id=${movie.id}`;

    // Рендер плеера + спиннера
    playerWrapper.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.style.position = 'relative';
    wrap.innerHTML = `<video id="videoPlayer" controls crossorigin="anonymous" playsinline
                         style="width:100%;border-radius:14px"></video>`;
    const spinner = createSpinner();
    wrap.appendChild(spinner);
    playerWrapper.appendChild(wrap);

    // Один бейдж с ID комнаты
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
      console.log('[ROOM] copied roomId to clipboard');
      alert('ID комнаты скопирован');
    };

    // HLS.js
    player = document.getElementById('videoPlayer');
    if (Hls.isSupported()) {
      const hls = new Hls({ debug: false });
      hls.loadSource(movie.videoUrl);
      hls.attachMedia(player);
      hls.on(Hls.Events.ERROR, (_, data) => {
        console.error('[HLS] Ошибка:', data);
        alert('Ошибка загрузки видео');
      });
      player.addEventListener('waiting', () => (spinner.style.display = 'block'));
      player.addEventListener('playing', () => (spinner.style.display = 'none'));
    } else if (player.canPlayType('application/vnd.apple.mpegurl')) {
      player.src = movie.videoUrl;
    } else {
      throw new Error('Ваш браузер не поддерживает HLS');
    }

    // Слушаем события play/pause/seeking
    player.addEventListener('play', () => {
      if (isSeeking || isRemoteAction) return;
      console.log('[PLAYER] local play at', player.currentTime);
      socket.emit('player_action', {
        roomId,
        position: player.currentTime,
        is_paused: false
      });
    });
    player.addEventListener('pause', () => {
      if (isSeeking || isRemoteAction) return;
      console.log('[PLAYER] local pause at', player.currentTime);
      socket.emit('player_action', {
        roomId,
        position: player.currentTime,
        is_paused: true
      });
    });
    player.addEventListener('seeking', () => {
      isSeeking = true;
      console.log('[PLAYER] local seeking start');
    });
    player.addEventListener('seeked', () => {
      console.log('[PLAYER] local seeked to', player.currentTime);
      if (!isRemoteAction) {
        socket.emit('player_action', {
          roomId,
          position: player.currentTime,
          is_paused: player.paused
        });
      }
      setTimeout(() => (isSeeking = false), 200);
    });

  } catch (err) {
    console.error('[ERROR] fetchRoom()', err);
    playerWrapper.innerHTML = `<p class="error">Ошибка: ${err.message}</p>`;
  }
}

fetchRoom();

// 8. Вспомогательная функция для чата
function appendMessage(author, text) {
  const div = document.createElement('div');
  div.className = 'chat-message';
  div.innerHTML = `<strong>${author}:</strong> ${text}`;
  messagesBox.appendChild(div);
  messagesBox.scrollTop = messagesBox.scrollHeight;
}
