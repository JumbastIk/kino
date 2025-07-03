// room.js

// ! Не объявляем params, roomId, socket — они уже есть из common.js

// --- Показываем ID комнаты ---
if (window.roomIdCode) roomIdCode.textContent = roomId;
if (window.copyRoomId) copyRoomId.onclick = () => {
  navigator.clipboard.writeText(roomId);
  alert('Скопировано!');
};

// --- Telegram WebApp интеграция ---
if (window.Telegram?.WebApp) {
  Telegram.WebApp.disableVerticalSwipes();
  Telegram.WebApp.enableClosingConfirmation();
}

// --- События сокета и интеграция функций из других файлов ---
socket.on('connect', () => {
  myUserId = socket.id;
  readyForControl = false;
  disableControls();
  hideStatus();
  socket.emit('join', { roomId, userData: { id: myUserId, first_name: 'Гость' } });
  socket.emit('request_state', { roomId });
  if (typeof fetchRoom === 'function') fetchRoom();
});
socket.on('disconnect', () => {
  showStatus('Отключено от сервера. Ждем восстановления…', '#fc8');
});
socket.on('reconnect_attempt', () => {
  showStatus('Пытаемся восстановить соединение…', '#fb4343');
});
socket.on('reconnect', () => {
  hideStatus();
  readyForControl = false;
  disableControls();
  socket.emit('request_state', { roomId });
});
socket.on('members', ms => {
  allMembers = ms;
  if (typeof updateMembersList === 'function') updateMembersList();
});
socket.on('history', data => {
  messagesBox.innerHTML = '';
  data.forEach(m => appendMessage(m.author, m.text));
});
socket.on('chat_message', m => appendMessage(m.author, m.text));
socket.on('system_message', msg => msg?.text && appendSystemMessage(msg.text));

// --- Синхронизация состояния ---
socket.on('user_time_update', data => {
  if (data?.user_id) {
    userTimeMap[data.user_id] = data.currentTime;
    userPingMap[data.user_id] = data.ping;
    if (typeof updateMembersList === 'function') updateMembersList();
  }
});
socket.on('sync_state', data => {
  planBAttempts = 0;
  if (typeof applySyncState === 'function') applySyncState(data);
  clearTimeout(syncErrorTimeout);
  syncErrorTimeout = setTimeout(() => {
    if (Date.now() - data.updatedAt > 1600) {
      if (typeof planB_RequestServerState === 'function') planB_RequestServerState();
    }
  }, 1700);
});

// === Пинг ===
if (typeof measurePingAndSend === 'function') {
  setInterval(measurePingAndSend, 1000);
}

// === Watchdog ===
setInterval(() => {
  if (!readyForControl) return;
  const median = typeof getMedianTime === 'function' ? getMedianTime() : player.currentTime;
  const delta = Math.abs(player.currentTime - median);
  if (delta > 2.3 && delta < 30 && !player.paused) {
    logOnce('Watchdog: Автосинхронизация (дельта ' + delta.toFixed(2) + ' сек.)');
    player.currentTime = median;
  }
}, 7000);

// === Visibilitychange, повторный sync ===
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    wasPausedOnHide = player.paused;
    ignoreSyncEvent = true;
  } else {
    ignoreSyncEvent = false;
    socket.emit('request_state', { roomId });
    setTimeout(() => socket.emit('request_state', { roomId }), 1000);
    if (!wasPausedOnHide) {
      player.play().catch(() => {});
    }
  }
});

// === SanityCheck ===
window.addEventListener('DOMContentLoaded', () => {
  if (typeof sanityCheck === 'function') sanityCheck();
});
