// room.js

const BACKEND = window.location.hostname.includes('localhost')
  ? 'http://localhost:3000'
  : 'https://kino-fhwp.onrender.com';

const socket = io(BACKEND, {
  path: '/socket.io',
  transports: ['websocket']
});

// Получаем ID комнаты из URL
const params = new URLSearchParams(window.location.search);
const roomId = params.get('roomId');
if (!roomId) {
  alert('Не указан ID комнаты.');
  location.href = 'index.html';
}

// Элементы страницы
const playerWrapper = document.getElementById('playerWrapper');
const backLink      = document.getElementById('backLink');
const messagesBox   = document.getElementById('messages');
const membersList   = document.getElementById('membersList');
const msgInput      = document.getElementById('msgInput');
const sendBtn       = document.getElementById('sendBtn');

// Переменные синхронизации плеера
let player, isSeeking = false, isRemoteAction = false;

// WebRTC голосовой чат
let localStream = null;
const peers = {};

// Добавляем кнопку Push-to-Talk
const micBtn = document.createElement('button');
micBtn.textContent = '🎤';
micBtn.className = 'mic-btn';
document.querySelector('.chat-input-wrap').appendChild(micBtn);

// При зажатии — включаем микрофон, при отпускании — выключаем
micBtn.addEventListener('mousedown', async () => {
  if (!localStream) {
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      socket.emit('new_peer', { roomId, from: socket.id });
    } catch (e) {
      console.error(e);
      return alert('Нет доступа к микрофону');
    }
  }
  // Создаём соединения с участниками
  for (const id of await getPeerIds()) {
    if (!peers[id]) await createPeer(id, true);
  }
});
micBtn.addEventListener('mouseup', () => {
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
    // закрываем все PeerConnection
    Object.values(peers).forEach(pc => pc.close());
    Object.keys(peers).forEach(id => delete peers[id]);
  }
});

// Сигналы WebRTC
socket.on('new_peer', async ({ from }) => {
  if (from === socket.id || !localStream) return;
  await createPeer(from, false);
});
socket.on('signal', async ({ from, description, candidate }) => {
  let pc = peers[from] || await createPeer(from, false);
  if (description) {
    await pc.setRemoteDescription(description);
    if (description.type === 'offer') {
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('signal', { to: from, description: pc.localDescription });
    }
  }
  if (candidate) {
    await pc.addIceCandidate(candidate);
  }
});

async function createPeer(peerId, isOffer) {
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
  });
  peers[peerId] = pc;

  if (localStream) {
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
  }

  pc.onicecandidate = e => {
    if (e.candidate) {
      socket.emit('signal', { to: peerId, candidate: e.candidate });
    }
  };

  pc.ontrack = e => {
    let audio = document.getElementById(`audio_${peerId}`);
    if (!audio) {
      audio = document.createElement('audio');
      audio.id = `audio_${peerId}`;
      audio.autoplay = true;
      document.body.appendChild(audio);
    }
    audio.srcObject = e.streams[0];
  };

  if (isOffer) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('signal', { to: peerId, description: pc.localDescription });
  }

  return pc;
}

async function getPeerIds() {
  const res = await fetch(`${BACKEND}/api/rooms/${roomId}/members`);
  const { data: members } = await res.json();
  return members.map(m => m.user_id).filter(id => id !== socket.id);
}

// Подключаемся к комнате и запрашиваем состояние плеера
socket.emit('join',          { roomId, userData: { id: socket.id, first_name: 'Гость' } });
socket.emit('request_state', { roomId });

// Обновляем список участников
socket.on('members', members => {
  membersList.innerHTML = `
    <div class="chat-members-label">Участники (${members.length}):</div>
    <ul>${members.map(m => `<li>${m.user_id}</li>`).join('')}</ul>
  `;
});

// История и новые сообщения
socket.on('history', data => {
  messagesBox.innerHTML = '';
  data.forEach(m => appendMessage(m.author, m.text));
});
socket.on('chat_message', m => appendMessage(m.author, m.text));

// Отправка сообщения
sendBtn.addEventListener('click', sendMessage);
msgInput.addEventListener('keydown', e => e.key === 'Enter' && sendMessage());
function sendMessage() {
  const text = msgInput.value.trim();
  if (!text) return;
  socket.emit('chat_message', { roomId, author: 'Гость', text });
  msgInput.value = '';
}

// Синхронизация плеера
socket.on('sync_state', ({ position=0, is_paused }) => {
  if (!player) return;
  isRemoteAction = true;
  player.currentTime = position;
  is_paused ? player.pause() : player.play().catch(() => {});
  setTimeout(() => isRemoteAction = false, 200);
});
socket.on('player_update', ({ position=0, is_paused }) => {
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

// Создаём спиннер для буферизации
function createSpinner() {
  const spinner = document.createElement('div');
  spinner.className = 'buffer-spinner';
  spinner.innerHTML = `
    <div class="double-bounce1"></div>
    <div class="double-bounce2"></div>
  `;
  spinner.style.display = 'none';
  return spinner;
}

// Загрузка данных комнаты и инициализация плеера
async function fetchRoom() {
  try {
    const res = await fetch(`${BACKEND}/api/rooms/${roomId}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const roomData = await res.json();

    // Назад к описанию
    const movie = movies.find(m => m.id === roomData.movie_id);
    if (!movie || !movie.videoUrl) throw new Error('Фильм не найден');
    backLink.href = `movie.html?id=${movie.id}`;

    // Отрисовка плеера + спиннера
    playerWrapper.innerHTML = '';
    const wrapper = document.createElement('div');
    wrapper.style.position = 'relative';
    wrapper.innerHTML = `
      <video id="videoPlayer" controls crossorigin="anonymous" playsinline
             style="width:100%;border-radius:14px"></video>
    `;
    const spinner = createSpinner();
    wrapper.appendChild(spinner);
    playerWrapper.appendChild(wrapper);

    // Бейдж с одним ID комнаты
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

    // Подключаем HLS.js
    const v = document.getElementById('videoPlayer');
    if (Hls.isSupported()) {
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

    // События управления плеером
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

// Утилита для добавления сообщений
function appendMessage(author, text) {
  const div = document.createElement('div');
  div.className = 'chat-message';
  div.innerHTML = `<strong>${author}:</strong> ${text}`;
  messagesBox.appendChild(div);
  messagesBox.scrollTop = messagesBox.scrollHeight;
}
