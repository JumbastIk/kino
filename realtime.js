const supabase = require('./supabase');

const roomsState      = {};
const broadcastTimers = {};
const BROADCAST_INTERVAL = 2000;

// Функция для более точного расчета текущей позиции
function calculatePosition(roomId) {
  const s = roomsState[roomId];
  if (!s) return { position: 0, is_paused: true, speed: 1, updatedAt: Date.now() };

  const now = Date.now();
  const elapsed = (now - s.updatedAt) / 1000;
  const position = s.playing ? s.time + elapsed * s.speed : s.time;

  return {
    position,
    is_paused: !s.playing,
    speed: s.speed,
    updatedAt: now
  };
}

// Планирование регулярной рассылки состояния
function scheduleBroadcast(io, roomId) {
  if (broadcastTimers[roomId]) return;

  broadcastTimers[roomId] = setInterval(() => {
    const syncData = calculatePosition(roomId);
    io.to(roomId).emit('sync_state', syncData);
    console.log(`[Broadcast] sync_state to room ${roomId}`, syncData);
  }, BROADCAST_INTERVAL);

  console.log(`[Schedule] Started broadcast timer for room ${roomId}`);
}

// Остановка рассылки и очистка состояния, если комната пуста
function clearBroadcast(io, roomId) {
  const room = io.sockets.adapter.rooms.get(roomId);
  if (!room || room.size === 0) {
    clearInterval(broadcastTimers[roomId]);
    delete broadcastTimers[roomId];
    delete roomsState[roomId];
    console.log(`[Clear] Stopped broadcast timer and cleared state for room ${roomId}`);
  }
}

module.exports = function(io) {
  io.on('connection', socket => {
    let currentRoom = null;
    let userId      = null;

    // Пользователь подключился к комнате
    socket.on('join', async ({ roomId, userData }) => {
      try {
        currentRoom = roomId;
        userId      = userData.id;
        socket.join(roomId);
        console.log(`[Join] User ${userId} joined room ${roomId}`);

        // Обновляем участников
        await supabase.from('room_members').upsert(
          { room_id: roomId, user_id: userId },
          { onConflict: ['room_id', 'user_id'] }
        );

        const { data: members } = await supabase.from('room_members').select('user_id').eq('room_id', roomId);
        io.to(roomId).emit('members', members);

        // Системное сообщение
        io.to(roomId).emit('system_message', {
          text: 'Пользователь вошёл в комнату',
          created_at: new Date().toISOString()
        });

        // История сообщений
        const { data: messages } = await supabase
          .from('messages')
          .select('author, text, created_at')
          .eq('room_id', roomId)
          .order('created_at', { ascending: true });
        socket.emit('history', messages);

        // Инициализация состояния
        if (!roomsState[roomId]) {
          roomsState[roomId] = { time: 0, playing: false, speed: 1, updatedAt: Date.now() };
          console.log(`[Init] Initialized state for room ${roomId}`);
        }

        // Отправка текущего состояния пользователю
        socket.emit('sync_state', calculatePosition(roomId));

        clearBroadcast(io, roomId);
        scheduleBroadcast(io, roomId);

      } catch (err) {
        console.error('[Join Error]', err.message);
      }
    });

    // Запрос текущего состояния вручную
    socket.on('request_state', ({ roomId }) => {
      console.log(`[Request State] for room ${roomId}`);
      socket.emit('sync_state', calculatePosition(roomId));
    });

    // Пинг-понг для измерения RTT
    socket.on('ping', () => {
      socket.emit('pong');
    });

    // Действия пользователя с плеером
    socket.on('player_action', ({ roomId, position, is_paused, speed }) => {
      try {
        if (typeof position !== 'number' || position < 0) return;

        const now = Date.now();
        roomsState[roomId] = {
          time: position,
          playing: !is_paused,
          speed: speed || 1,
          updatedAt: now
        };

        const updateData = {
          position,
          is_paused,
          speed: speed || 1,
          updatedAt: now
        };

        io.to(roomId).emit('player_update', updateData);
        console.log(`[Player Action] in room ${roomId}`, updateData);

        clearBroadcast(io, roomId);
        scheduleBroadcast(io, roomId);
      } catch (err) {
        console.error('[Player Action Error]', err.message);
      }
    });

    // Чат
    socket.on('chat_message', async msg => {
      try {
        await supabase.from('messages').insert([{
          room_id: msg.roomId,
          author:  msg.author,
          text:    msg.text
        }]);

        const chatMsg = {
          author:     msg.author,
          text:       msg.text,
          created_at: new Date().toISOString()
        };
        io.to(msg.roomId).emit('chat_message', chatMsg);
        console.log(`[Chat Message] in room ${msg.roomId}`, chatMsg);
      } catch (err) {
        console.error('[Chat Error]', err.message);
      }
    });

    // Пользователь отключился
    socket.on('disconnect', async () => {
      try {
        if (!currentRoom || !userId) return;

        await supabase.from('room_members').delete().match({ room_id: currentRoom, user_id: userId });

        const { data: members } = await supabase.from('room_members').select('user_id').eq('room_id', currentRoom);
        io.to(currentRoom).emit('members', members);

        io.to(currentRoom).emit('system_message', {
          text: 'Пользователь вышел из комнаты',
          created_at: new Date().toISOString()
        });

        console.log(`[Disconnect] User ${userId} left room ${currentRoom}`);

        clearBroadcast(io, currentRoom);
      } catch (err) {
        console.error('[Disconnect Error]', err.message);
      }
    });
  });
};
