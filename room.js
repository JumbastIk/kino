// room.js

const BACKEND = window.location.hostname.includes('localhost')
  ? 'http://localhost:3000'
  : 'https://kino-fhwp.onrender.com';

const socket = io(BACKEND, {
  path: '/socket.io',
  transports: ['websocket']
});

const params = new URLSearchParams(window.location.search);
const roomId = params.get('roomId');
if (!roomId) {
  alert('Не указан ID комнаты.');
  location.href = 'index.html';
}

const playerWrapper = document.getElementById('playerWrapper');
const backLink      = document.getElementById('backLink');
const msgInput      = document.getElementById('msgInput');
const sendBtn       = document.getElementById('sendBtn');
const messagesBox   = document.getElementById('messages');
const membersList   = document.getElementById('membersList');

let player;
let isSeeking      = false;
let isRemoteAction = false;

// ==== WebRTC голосовой чат ====
let localStream = null;
const peers = {}; // { peerId: RTCPeerConnection }

// создаём кнопку «Микрофон» внизу чата
const micBtn = document.createElement('button');
micBtn.textContent = '🎤 Вкл. микрофон';
micBtn.className = 'mic-btn';
document.querySelector('.chat-input-wrap').appendChild(micBtn);

micBtn.addEventListener('click', async () => {
  if (!localStream) {
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micBtn.textContent = '🔇 Выкл. микрофон';
      socket.emit('new_peer', { roomId });
    } catch (err) {
      console.error('Не удалось получить микрофон:', err);
      alert('Ошибка доступа к микрофону');
    }
  } else {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
    micBtn.textContent = '🎤 Вкл. микрофон';
    // закрываем все соединения
    Object.values(peers).forEach(pc => pc.close());
    Object.keys(peers).forEach(id => delete peers[id]);
  }
});

socket.on('new_peer', async ({ from }) => {
  if (localStream && from !== socket.id) {
    await createPeerConnection(from, true);
  }
});

socket.on('signal', async ({ from, description, candidate }) => {
  let pc = peers[from];
  if (!pc) {
    pc = await createPeerConnection(from, false);
  }
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

async function createPeerConnection(peerId, isOffer) {
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
  });
  peers[peerId] = pc;

  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

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

// ==== Socket.IO: комната, чат, плеер ====
socket.emit('join',          { roomId, userData: { id: socket.id, first_name: 'Гость' } });
socket.emit('request_state', { roomId });

socket.on('members', members => {
  const count = Array.isArray(members) ? members.length : 0;
  membersList.innerHTML = `
    <div class="chat-members-label">Участники (${count}):</div>
    <ul>${members.map(m => `<li>${m.user_id}</li>`).join('')}</ul>
  `;
});

socket.on('system_message', ({ text }) => {
  const div = document.createElement('div');
  div.className = 'chat-system';
  div.textContent = text;
  messagesBox.appendChild(div);
  messagesBox.scrollTop = messagesBox.scrollHeight;
});

socket.on('history', data => {
  messagesBox.innerHTML = '';
  data.forEach(m => appendMessage(m.author, m.text));
});
socket.on('chat_message', m => appendMessage(m.author, m.text));

sendBtn.addEventListener('click', sendMessage);
msgInput.addEventListener('keydown', e => e.key === 'Enter' && sendMessage());
function sendMessage() {
  const text = msgInput.value.trim();
  if (!text) return;
  socket.emit('chat_message', { roomId, author: 'Гость', text });
  msgInput.value = '';
}

socket.on('sync_state', ({ position = 0, is_paused }) => {
  if (!player) return;
  isRemoteAction = true;
  player.currentTime = position;
  is_paused ? player.pause() : player.play().catch(() => {});
  setTimeout(() => isRemoteAction = false, 200);
});
socket.on('player_update', ({ position = 0, is_paused }) => {
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

// === Индикатор буферизации ===
function createSpinner() {
  const spinner = document.createElement('div');
  spinner.className = 'buffer-spinner';
  spinner.innerHTML = '<div class="double-bounce1"></div><div class="double-bounce2"></div>';
  spinner.style.display = 'none';
  return spinner;
}

async function fetchRoom() {
  try {
    const res = await fetch(`${BACKEND}/api/rooms/${roomId}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const roomData = await res.json();
    if (!roomData) throw new Error('Комната не найдена');

    const movie = movies.find(m => m.id === roomData.movie_id);
    if (!movie || !movie.videoUrl) throw new Error('Фильм не найден');

    backLink.href = `movie.html?id=${movie.id}`;

    playerWrapper.innerHTML = '';
    const container = document.createElement('div');
    container.style.position = 'relative';
    container.innerHTML = '<video id="videoPlayer" class="video-player" controls crossorigin="anonymous" playsinline style="width:100%;"></video>';
    const spinner = createSpinner();
    container.appendChild(spinner);
    playerWrapper.appendChild(container);

    const video = document.getElementById('videoPlayer');

    if (Hls.isSupported()) {
      const hls = new Hls({ debug: false });
      hls.loadSource(movie.videoUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.ERROR, (_, data) => {
        console.error('[HLS] Ошибка:', data);
        alert(`Ошибка загрузки видео.\nПроверьте CORS/CDN для ${window.location.origin}`);
      });
      video.addEventListener('waiting', () => spinner.style.display = 'block');
      video.addEventListener('playing', () => spinner.style.display = 'none');
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = movie.videoUrl;
    } else {
      throw new Error('Ваш браузер не поддерживает HLS');
    }

    video.addEventListener('play', () => {
      if (isSeeking || isRemoteAction) return;
      socket.emit('player_action', { roomId, position: video.currentTime, is_paused: false });
    });
    video.addEventListener('pause', () => {
      if (isSeeking || isRemoteAction) return;
      socket.emit('player_action', { roomId, position: video.currentTime, is_paused: true });
    });
    video.addEventListener('seeking', () => isSeeking = true);
    video.addEventListener('seeked', () => {
      if (!isRemoteAction) {
        socket.emit('player_action', { roomId, position: video.currentTime, is_paused: video.paused });
      }
      setTimeout(() => isSeeking = false, 200);
    });

    player = video;
  } catch (err) {
    console.error('[ERROR] Ошибка комнаты:', err);
    playerWrapper.innerHTML = `<p class="error">Ошибка: ${err.message}</p>`;
  }
}

fetchRoom();

// чат-утилита
function appendMessage(author, text) {
  const div = document.createElement('div');
  div.className = 'chat-message';
  div.innerHTML = `<strong>${author}:</strong> ${text}`;
  messagesBox.appendChild(div);
  messagesBox.scrollTop = messagesBox.scrollHeight;
}
