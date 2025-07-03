// chat.js

// ==== Чат: XSS, лимит длины, добавление сообщений, обработка ====

function escapeHtml(str) {
  return String(str).replace(/[&<>"'`=\/]/g, function(s) {
    return ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;',
      '=': '&#61;', '/': '&#47;'
    })[s];
  });
}

function appendMessage(author, text) {
  const d = document.createElement('div');
  d.className = 'chat-message';
  d.innerHTML = `<strong>${escapeHtml(author)}:</strong> ${escapeHtml(text)}`;
  messagesBox.appendChild(d);
  messagesBox.scrollTop = messagesBox.scrollHeight;
}
function appendSystemMessage(text) {
  const d = document.createElement('div');
  d.className = 'chat-message system-message';
  d.innerHTML = `<em>${escapeHtml(text)}</em>`;
  messagesBox.appendChild(d);
  messagesBox.scrollTop = messagesBox.scrollHeight;
}

sendBtn.addEventListener('click', sendMessage);
msgInput.addEventListener('keydown', e => { if (e.key === 'Enter') sendMessage(); });

function sendMessage() {
  const t = msgInput.value.trim();
  if (!t) return;
  if (t.length > 1000) {
    showStatus('Сообщение слишком длинное!', '#a23');
    setTimeout(hideStatus, 1500);
    return;
  }
  socket.emit('chat_message', { roomId, author: 'Гость', text: t });
  msgInput.value = '';
}

// === Обработка socket событий ===

socket.on('history', data => {
  messagesBox.innerHTML = '';
  data.forEach(m => appendMessage(m.author, m.text));
});
socket.on('chat_message', m => appendMessage(m.author, m.text));
socket.on('system_message', msg => msg?.text && appendSystemMessage(msg.text));
