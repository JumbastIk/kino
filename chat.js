// chat.js

// Глобально объявляем setupChat
window.setupChat = function({ socket, roomId, messagesBox, msgInput, sendBtn }) {
  // === История, сообщения, системные сообщения ===
  socket.on('history', data => {
    messagesBox.innerHTML = '';
    data.forEach(m => appendMessage(m.author, m.text));
  });
  socket.on('chat_message', m => appendMessage(m.author, m.text));
  socket.on('system_message', msg => {
    if (msg && msg.text) appendSystemMessage(msg.text);
  });

  // === Отправка сообщений ===
  sendBtn.addEventListener('click', sendMessage);
  msgInput.addEventListener('keydown', e => e.key === 'Enter' && sendMessage());

  function sendMessage() {
    const text = msgInput.value.trim();
    if (!text) return;
    socket.emit('chat_message', { roomId, author: 'Гость', text });
    msgInput.value = '';
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
}
