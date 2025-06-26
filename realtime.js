// realtime.js

const supabase = require('./supabase');

// Глобальный state для синхронизации плеера во всех комнатах
// roomsState[roomId] = { time: Number, playing: Boolean, speed: Number, updatedAt: Number }
const roomsState      = {};
// Для периодической рассылки прогнозного состояния
const broadcastTimers = {};

module.exports = function(io) {
  io.on('connection', socket => {
    let currentRoom = null;
    let userId      = null;

    // === Helper: запустить рассылку прогноза каждые 5 секунд ===
    function startBroadcast(roomId) {
      if (broadcastTimers[roomId]) return;
      broadcastTimers[roomId] = setInterval(() => {
        const s = roomsState[roomId];
        if (!s) return;
        const now     = Date.now();
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
      }, 5000);
    }

    // === Helper: остановить рассылку и очистить state, если в комнате никого нет ===
    function stopBroadcastIfEmpty(roomId) {
      const room = io.sockets.adapter.rooms.get(roomId);
      if (!room || room.size === 0) {
        clearInterval(broadcastTimers[roomId]);
        delete broadcastTimers[roomId];
        delete roomsState[roomId];
      }
    }

    // ===== Вход в комнату =====
    socket.on('join', async ({ roomId, userData }) => {
      try {
        currentRoom = roomId;
        userId      = userData.id;
        socket.join(roomId);

        // — Обновляем список участников в БД —
        await supabase
          .from('room_members')
          .upsert(
            { room_id: roomId, user_id: userId },
            { onConflict: ['room_id','user_id'] }
          );

        // — Шлём всем обновлённый список участников —
        const { data: members } = await supabase
          .from('room_members')
          .select('user_id')
          .eq('room_id', roomId);
        io.to(roomId).emit('members', members);

        // — Системное сообщение о входе —
        io.to(roomId).emit('system_message', {
          text:       `Пользователь вошёл в комнату`,
          created_at: new Date().toISOString()
        });

        // — История чата для новичка —
        const { data: messages } = await supabase
          .from('messages')
          .select('author, text, created_at')
          .eq('room_id', roomId)
          .order('created_at', { ascending: true });
        socket.emit('history', messages);

        // — Инициализируем состояние плеера, если ещё не было —
        if (!roomsState[roomId]) {
          roomsState[roomId] = {
            time:      0,
            playing:   false,
            speed:     1,
            updatedAt: Date.now()
          };
        }

        // — Запускаем периодическую рассылку прогноза для этой комнаты —
        startBroadcast(roomId);

        // — Отправляем новичку текущее состояние —
        const s = roomsState[roomId];
        socket.emit('sync_state', {
          position:  s.time,
          is_paused: !s.playing,
          speed:     s.speed,
          updatedAt: s.updatedAt
        });

      } catch (err) {
        console.error('Error on join:', err.message);
      }
    });

    // ===== Получение актуального состояния по запросу =====
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

    // ===== Пинг-понг для измерения RTT =====
    socket.on('ping', () => {
      socket.emit('pong');
    });

    // ===== Синхронизация действий плеера =====
    socket.on('player_action', ({ roomId, position, is_paused, speed }) => {
      // Сервер ставит своё время
      const now = Date.now();

      // Обновляем состояние
      roomsState[roomId] = {
        time:      position,
        playing:   !is_paused,
        speed:     speed || 1,
        updatedAt: now
      };

      // Мгновенно отсылаем всем остальным
      socket.to(roomId).emit('player_update', {
        position,
        is_paused,
        speed:     speed || 1,
        updatedAt: now
      });
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

    // ===== Отключение пользователя =====
    socket.on('disconnect', async () => {
      try {
        if (!currentRoom || !userId) return;

        // — Удаляем из списка участников —
        await supabase
          .from('room_members')
          .delete()
          .match({ room_id: currentRoom, user_id: userId });

        // — Обновляем список и шлём всем —
        const { data: members } = await supabase
          .from('room_members')
          .select('user_id')
          .eq('room_id', currentRoom);
        io.to(currentRoom).emit('members', members);

        // — Системное сообщение о выходе —
        io.to(currentRoom).emit('system_message', {
          text:       `Пользователь вышел из комнаты`,
          created_at: new Date().toISOString()
        });

        // — Если комната пустая, убираем таймер и state —
        stopBroadcastIfEmpty(currentRoom);

      } catch (err) {
        console.error('Error on disconnect:', err.message);
      }
    });
  });
};
