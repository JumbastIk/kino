// webrtc.js

window.setupWebRTC = function({ socket, roomId, membersListSelector = '#membersList', micBtnParent = '.chat-input-wrap' }) {
  // --- Стартовые значения и DOM ---
  let localStream = null;
  const peers = {};
  let peerIds = [];
  let isTalking = false;

  const membersList = document.querySelector(membersListSelector);

  // Кнопка микрофона
  const micBtn = document.createElement('button');
  micBtn.textContent = '🎤';
  micBtn.className = 'mic-btn';
  document.querySelector(micBtnParent).appendChild(micBtn);

  // --- Список участников и Peer connections ---
  socket.on('members', members => {
    peerIds = members.map(m => m.user_id).filter(id => id !== socket.id);
    if (membersList) {
      membersList.innerHTML =
        `<div class="chat-members-label">Участники (${members.length}):</div>
        <ul>${members.map(m => `<li>${m.user_id}</li>`).join('')}</ul>`;
    }
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
}
