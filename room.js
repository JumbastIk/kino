// room.js

// ! Не объявляем params, roomId, socket, player и др. — они уже есть из common.js

console.log('[room.js] Запущен, roomId:', roomId);

// --- Показываем ID комнаты ---
if (window.roomIdCode) {
  roomIdCode.textContent = roomId;
  console.log('[room.js] Показали roomId:', roomId);
}
if (window.copyRoomId) {
  copyRoomId.onclick = () => {
    navigator.clipboard.writeText(roomId);
    alert('Скопировано!');
    console.log('[room.js] Скопирован roomId:', roomId);
  };
}

// --- Telegram WebApp интеграция ---
if (window.Telegram?.WebApp) {
  console.log('[room.js] Telegram WebApp detected');
  Telegram.WebApp.disableVerticalSwipes();
  Telegram.WebApp.enableClosingConfirmation();
}

// --- События сокета и интеграция функций из других файлов ---
socket.on('connect', () => {
  myUserId = socket.id;
  readyForControl = false;
  disableControls();
  hideStatus();
  console.log('[room.js] socket.connect:', socket.id);
  socket.emit('join', { roomId, userData: { id: myUserId, first_name: 'Гость' } });
  socket.emit('request_state', { roomId });
  if (typeof fetchRoom === 'function') {
    console.log('[room.js] fetchRoom вызван');
    fetchRoom();
  }
});
socket.on('disconnect', () => {
  showStatus('Отключено от сервера. Ждем восстановления…', '#fc8');
  console.log('[room.js] socket.disconnect');
});
socket.on('reconnect_attempt', () => {
  showStatus('Пытаемся восстановить соединение…', '#fb4343');
  console.log('[room.js] socket.reconnect_attempt');
});
socket.on('reconnect', () => {
  hideStatus();
  readyForControl = false;
  disableControls();
  console.log('[room.js] socket.reconnect');
  socket.emit('request_state', { roomId });
});
socket.on('members', ms => {
  allMembers = ms;
  console.log('[room.js] members:', ms);
  if (typeof updateMembersList === 'function') updateMembersList();
});
socket.on('history', data => {
  console.log('[room.js] history:', data);
  messagesBox.innerHTML = '';
  data.forEach(m => appendMessage(m.author, m.text));
});
socket.on('chat_message', m => {
  console.log('[room.js] chat_message:', m);
  appendMessage(m.author, m.text);
});
socket.on('system_message', msg => {
  if (msg?.text) {
    console.log('[room.js] system_message:', msg.text);
    appendSystemMessage(msg.text);
  }
});

// --- Синхронизация состояния ---
socket.on('user_time_update', data => {
  console.log('[room.js] user_time_update:', data);
  if (data?.user_id) {
    userTimeMap[data.user_id] = data.currentTime;
    userPingMap[data.user_id] = data.ping;
    if (typeof updateMembersList === 'function') updateMembersList();
  }
});
socket.on('sync_state', data => {
  planBAttempts = 0;
  console.log('[room.js] sync_state:', data);
  if (typeof applySyncState === 'function') applySyncState(data);
  clearTimeout(syncErrorTimeout);
  syncErrorTimeout = setTimeout(() => {
    if (Date.now() - data.updatedAt > 1600) {
      if (typeof planB_RequestServerState === 'function') {
        console.warn('[room.js] syncErrorTimeout! Вызван planB_RequestServerState()');
        planB_RequestServerState();
      }
    }
  }, 1700);

  // --- ВАЖНО: Разблокировать плеер после sync ---
  readyForControl = true;
  if (typeof enableControls === 'function') {
    console.log('[room.js] enableControls вызван после sync_state');
    enableControls();
  }
});

// === Пинг ===
if (typeof measurePingAndSend === 'function') {
  setInterval(() => {
    console.log('[room.js] measurePingAndSend tick');
    measurePingAndSend();
  }, 1000);
}

// === Watchdog ===
setInterval(() => {
  if (!readyForControl) return;
  const median = typeof getMedianTime === 'function' ? getMedianTime() : player.currentTime;
  const delta = Math.abs(player.currentTime - median);
  if (delta > 2.3 && delta < 30 && !player.paused) {
    logOnce('Watchdog: Автосинхронизация (дельта ' + delta.toFixed(2) + ' сек.)');
    player.currentTime = median;
    console.warn('[room.js] Watchdog: Автосинхронизация! delta:', delta, 'median:', median, 'cur:', player.currentTime);
  }
}, 7000);

// === Visibilitychange, повторный sync ===
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    wasPausedOnHide = player.paused;
    ignoreSyncEvent = true;
    console.log('[room.js] document.hidden (пауза):', wasPausedOnHide);
  } else {
    ignoreSyncEvent = false;
    console.log('[room.js] document.visible — повторный sync');
    socket.emit('request_state', { roomId });
    setTimeout(() => socket.emit('request_state', { roomId }), 1000);
    if (!wasPausedOnHide) {
      player.play().catch(e => {
        console.warn('[room.js] player.play() failed after visibilitychange', e);
      });
    }
  }
});

// === SanityCheck ===
window.addEventListener('DOMContentLoaded', () => {
  console.log('[room.js] DOMContentLoaded');
  if (typeof sanityCheck === 'function') {
    sanityCheck();
    console.log('[room.js] sanityCheck вызван');
  }
});
