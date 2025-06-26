// realtime.js

const supabase = require('./supabase');

// Структура: roomsState[roomId] = { time, playing, speed, updatedAt }
const roomsState      = {};
// Таймеры для каждой комнаты
const broadcastTimers = {};
// Интервал между «прогнозными» рассылками (мс)
const BROADCAST_INTERVAL = 5000;

// Запустить периодическую рассылку состояния
function scheduleBroadcast(io, roomId) {
  if (broadcastTimers[roomId]) return;
  broadcastTimers[roomId] = setInterval(() => {
    const s = roomsState[roomId];
    if (!s) return;

    const now     = Date.now();
    // Прогноз позиции по последнему known-state
    const elapsed = (now - s.updatedAt) / 1000;
    const pos     = s.playing
      ? s.time + elapsed * s.speed
      : s.time;

    io.to(roomId).emit('sync_state', {
      position:  pos,
      is_paused: !s.playing,
      speed:     s.speed,
      updatedAt: now
    });
  }, BROADCAST_INTERVAL);
}

// Очистить таймер и state, если в комнате никого не осталось
function clearBroadcast(io, roomId) {
  const room = io.sockets.adapter.rooms.get(roomId);
  if (!room || room.size === 0) {
    clearInterval(broadcastTimers[roomId]);
    delete broadcastTimers[roomId];
    delete roomsState[roomId];
  }
}

module.exports = function(io) {
  io.on('connection', socket => {
    let currentRoom = null;
    let userId      = null;

    // ===== Пользователь заходит в комнату =====
    socket.on('join', async ({ roomId, userData }) => {
      try {
        currentRoom = roomId;
        userId      = userData.id;
        socket.join(roomId);

        // — обновляем таблицу участников —
        await supabase
          .from('room_members')
          .upsert(
            { room_id: roomId, user_id: userId },
            { onConflict: ['room_id','user_id'] }
          );

        // — рассылаем новый список участников —
        const { data: members } = await supabase
          .from('room_members')
          .select('user_id')
          .eq('room_id', roomId);
        io.to(roomId).emit('members', members);

        // — системное сообщение о входе —
        io.to(roomId).emit('system_message', {
          text:       'Пользователь вошёл в комнату',
          created_at: new Date().toISOString()
        });

        // — история чата —
        const { data: messages } = await supabase
          .from('messages')
          .select('author, text, created_at')
          .eq('room_id', roomId)
          .order('created_at', { ascending: true });
        socket.emit('history', messages);

        // — инициализируем state, если надо —
        if (!roomsState[roomId]) {
          roomsState[roomId] = {
            time:      0,
            playing:   false,
            speed:     1,
            updatedAt: Date.now()
          };
        }

        // — моментальный отправляем текущее состояние —
        const s = roomsState[roomId];
        socket.emit('sync_state', {
          position:  s.time,
          is_paused: !s.playing,
          speed:     s.speed,
          updatedAt: s.updatedAt
        });

        // — и запускаем/рестартуем периодическую рассылку —
        clearBroadcast(io, roomId);
        scheduleBroadcast(io, roomId);

      } catch (err) {
        console.error('Error on join:', err.message);
      }
    });

    // ===== По запросу выдаём актуальное состояние =====
    socket.on('request_state', ({ roomId }) => {
      const s = roomsState[roomId] || {
        time:      0,
        playing:   false,
        speed:     1,
        updatedAt: Date.now()
      };
      socket.emit('sync_state', {
        position:  s.time,
        is_paused: !s.playing,
        speed:     s.speed,
        updatedAt: s.updatedAt
      });
    });

    // ===== RTT-мерялка =====
    socket.on('ping', () => {
      socket.emit('pong');
    });

    // ===== Когда кто-то play/pause/seek =====
    socket.on('player_action', ({ roomId, position, is_paused, speed }) => {
      const now = Date.now();

      // Обновляем server-side state
      roomsState[roomId] = {
        time:      position,
        playing:   !is_paused,
        speed:     speed || 1,
        updatedAt: now
      };

      // Моментально сообщаем *всем* (включая отправителя)
      io.to(roomId).emit('player_update', {
        position,
        is_paused,
        speed:     speed || 1,
        updatedAt: now
      });

      // Рестартуем периодическую рассылку, чтобы не прилетел старый «прогноз»
      clearBroadcast(io, roomId);
      scheduleBroadcast(io, roomId);
    });

    // ===== Чат =====
    socket.on('chat_message', async msg => {
      try {
        await supabase.from('messages').insert([{
          room_id: msg.roomId,
          author:  msg.author,
          text:    msg.text
        }]);
        io.to(msg.roomId).emit('chat_message', {
          author:     msg.author,
          text:       msg.text,
          created_at: new Date().toISOString()
        });
      } catch (err) {
        console.error('Error on chat_message:', err.message);
      }
    });

    // ===== Выход пользователя =====
    socket.on('disconnect', async () => {
      try {
        if (!currentRoom || !userId) return;

        await supabase
          .from('room_members')
          .delete()
          .match({ room_id: currentRoom, user_id: userId });

        const { data: members } = await supabase
          .from('room_members')
          .select('user_id')
          .eq('room_id', currentRoom);
        io.to(currentRoom).emit('members', members);

        io.to(currentRoom).emit('system_message', {
          text:       'Пользователь вышел из комнате',
          created_at: new Date().toISOString()
        });

        // Если комната пуста — чистим state и таймер
        clearBroadcast(io, currentRoom);
      } catch (err) {
        console.error('Error on disconnect:', err.message);
      }
    });
  });
};
