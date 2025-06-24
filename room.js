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
const messagesBox   = document.getElementById('messages');
const membersList   = document.getElementById('membersList');
const msgInput      = document.getElementById('msgInput');
const sendBtn       = document.getElementById('sendBtn');

let player, isSeeking = false, isRemoteAction = false;

// ====== ГОЛОСОВОЙ ЧАТ (Push-to-Talk) ======
let localStream = null;
const peers = {};
let peerIds = []; // Всегда актуальный список peer id (кроме себя)

const micBtn = document.createElement('button');
micBtn.textContent = '🎤';
micBtn.className = 'mic-btn';
document.querySelector('.chat-input-wrap').appendChild(micBtn);

let isTalking = false;

socket.on('members', members => {
  peerIds = members.map(m => m.user_id).filter(id => id !== socket.id);
  membersList.innerHTML =
    `<div class="chat-members-label">Участники (${members.length}):</div>
    <ul>${members.map(m => `<li>${m.user_id}</li>`).join('')}</ul>`;

  peerIds.forEach(id => {
    if (!peers[id]) createPeer(id, true);
  });
  Object.keys(peers).forEach(id => {
    if (!peerIds.includes(id)) {
      peers[id].close();
      delete peers[id];
      const audio = document.getElementById(`audio_${id}`);
      if (audio) audio.remove();
    }
  });
});

// --- Push-to-Talk микрофон ---
micBtn.addEventListener('mousedown', async () => {
  if (isTalking) return;
  isTalking = true;
  micBtn.classList.add('active');
  try {
    if (!localStream) {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    }
    addAudioTracksToPeers();
    socket.emit('new_peer', { roomId, from: socket.id });
  } catch (e) {
    alert('Нет доступа к микрофону');
    micBtn.classList.remove('active');
    isTalking = false;
  }
});
micBtn.addEventListener('mouseup', () => {
  if (!isTalking) return;
  isTalking = false;
  micBtn.classList.remove('active');
  removeAudioTracksFromPeers();
});
micBtn.addEventListener('touchstart', e => {
  e.preventDefault();
  micBtn.dispatchEvent(new MouseEvent('mousedown'));
});
micBtn.addEventListener('touchend', e => {
  e.preventDefault();
  micBtn.dispatchEvent(new MouseEvent('mouseup'));
});

function addAudioTracksToPeers() {
  if (!localStream) return;
  for (const pc of Object.values(peers)) {
    localStream.getAudioTracks().forEach(track => {
      pc.addTrack(track, localStream);
    });
  }
}
function removeAudioTracksFromPeers() {
  for (const pc of Object.values(peers)) {
    pc.getSenders().forEach(sender => {
      if (sender.track && sender.track.kind === 'audio') {
        pc.removeTrack(sender);
      }
    });
  }
}

// --- WebRTC handshake ---
socket.on('new_peer', async ({ from }) => {
  if (from === socket.id) return;
  if (!peers[from]) await createPeer(from, false);
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
  if (candidate) await pc.addIceCandidate(candidate);
});

async function createPeer(peerId, isOffer) {
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
  });
  peers[peerId] = pc;

  if (localStream && isTalking) {
    localStream.getAudioTracks().forEach(track => {
      pc.addTrack(track, localStream);
    });
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

// =========== Всё остальное UI, плеер и чат ===========

socket.emit('join',          { roomId, userData: { id: socket.id, first_name: 'Гость' } });
socket.emit('request_state', { roomId });

socket.on('history', data => {
  messagesBox.innerHTML = '';
  data.forEach(m => appendMessage(m.author, m.text));
});
socket.on('chat_message', m => appendMessage(m.author, m.text));
socket.on('system_message', msg => {
  if (msg && msg.text) appendSystemMessage(msg.text);
});

sendBtn.addEventListener('click', sendMessage);
msgInput.addEventListener('keydown', e => e.key === 'Enter' && sendMessage());
function sendMessage() {
  const text = msgInput.value.trim();
  if (!text) return;
  socket.emit('chat_message', { roomId, author: 'Гость', text });
  msgInput.value = '';
}

// ========== ПРИЁМ sync_state и player_update, отправка player_action ==========

socket.on('sync_state', applySyncState);
socket.on('player_update', applySyncState);

function applySyncState({ position = 0, is_paused }) {
  if (!player) return;
  isRemoteAction = true;
  isSeeking = true;
  player.currentTime = position;
  if (is_paused) {
    player.pause();
  } else {
    player.play().catch(() => {});
  }
  setTimeout(() => {
    isRemoteAction = false;
    isSeeking = false;
  }, 200);
}

function createSpinner() {
  const s = document.createElement('div');
  s.className = 'buffer-spinner';
  s.innerHTML =
    `<div class="double-bounce1"></div>
    <div class="double-bounce2"></div>`;
  s.style.display = 'none';
  return s;
}

async function fetchRoom() {
  try {
    const res = await fetch(`${BACKEND}/api/rooms/${roomId}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const roomData = await res.json();

    const movie = movies.find(m => m.id === roomData.movie_id);
    if (!movie || !movie.videoUrl) throw new Error('Фильм не найден');
    backLink.href = `${movie.html}?id=${movie.id}`;

    playerWrapper.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.style.position = 'relative';
    wrap.innerHTML =
      `<video id="videoPlayer" controls crossorigin="anonymous" playsinline
             style="width:100%;border-radius:14px"></video>`;
    const spinner = createSpinner();
    wrap.appendChild(spinner);
    playerWrapper.appendChild(wrap);

    const badge = document.createElement('div');
    badge.className = 'room-id-badge';
    badge.innerHTML =
      `<small>ID комнаты:</small>
      <code>${roomId}</code>
      <button id="copyRoomId">Копировать</button>`;
    playerWrapper.after(badge);
    document.getElementById('copyRoomId').onclick = () => {
      navigator.clipboard.writeText(roomId);
      alert('ID комнаты скопирован');
    };

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
