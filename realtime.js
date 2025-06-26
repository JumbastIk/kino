// realtime.js

const supabase = require('./supabase');

// Глобальный state для синхронизации плеера во всех комнатах
// roomsState[roomId] = { time: Number, playing: Boolean, speed: Number, updatedAt: Number }
const roomsState = {};

module.exports = function(io) {
  io.on('connection', socket => {
    let currentRoom = null;
    let userId      = null;

    // ===== Вход в комнату =====
    socket.on('join', async ({ roomId, userData }) => {
      try {
        currentRoom = roomId;
        userId      = userData.id;
        socket.join(roomId);

        // Обновляем список участников в базе
        await supabase
          .from('room_members')
          .upsert(
            { room_id: roomId, user_id: userId },
            { onConflict: ['room_id','user_id'] }
          );

        // Шлем всем обновленный список участников
        const { data: members } = await supabase
          .from('room_members')
          .select('user_id')
          .eq('room_id', roomId);

        io.to(roomId).emit('members', members);

        // Системное сообщение о входе
        io.to(roomId).emit('system_message', {
          text:       `Пользователь вошёл в комнату`,
          created_at: new Date().toISOString()
        });

        // История чата
        const { data: messages } = await supabase
          .from('messages')
          .select('author, text, created_at')
          .eq('room_id', roomId)
          .order('created_at', { ascending: true });

        socket.emit('history', messages);

        // Инициализируем состояние плеера, если ещё не было
        if (!roomsState[roomId]) {
          roomsState[roomId] = {
            time:      0,
            playing:   false,
            speed:     1,
            updatedAt: Date.now()
          };
        }

        // Отправляем новичку текущее состояние плеера
        const state = roomsState[roomId];
        socket.emit('sync_state', {
          position:  state.time,
          is_paused: !state.playing,
          speed:     state.speed,
          updatedAt: state.updatedAt
        });

      } catch (err) {
        console.error('Error on join:', err.message);
      }
    });

    // ===== Получение актуального состояния по запросу =====
    socket.on('request_state', ({ roomId }) => {
      const state = roomsState[roomId] || {
        time:      0,
        playing:   false,
        speed:     1,
        updatedAt: Date.now()
      };
      socket.emit('sync_state', {
        position:  state.time,
        is_paused: !state.playing,
        speed:     state.speed,
        updatedAt: state.updatedAt
      });
    });

    // ===== Синхронизация действий плеера =====
    socket.on('player_action', ({ roomId, position, is_paused, speed, updatedAt }) => {
      const prev = roomsState[roomId] || {};

      // Игнорируем устаревшие события
      if (prev.updatedAt >= updatedAt) {
        return;
      }

      // Сохраняем новое состояние
      roomsState[roomId] = {
        time:      position,
        playing:   !is_paused,
        speed:     speed || 1,
        updatedAt: updatedAt
      };

      // Рассылаем обновление всем остальным
      socket.to(roomId).emit('player_update', {
        position,
        is_paused,
        speed:     speed || 1,
        updatedAt
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

        // Удаляем из списка участников
        await supabase
          .from('room_members')
          .delete()
          .match({ room_id: currentRoom, user_id: userId });

        // Шлём всем обновлённый список участников
        const { data: members } = await supabase
          .from('room_members')
          .select('user_id')
          .eq('room_id', currentRoom);

        io.to(currentRoom).emit('members', members);

        // Системное сообщение о выходе
        io.to(currentRoom).emit('system_message', {
          text:       `Пользователь вышел из комнаты`,
          created_at: new Date().toISOString()
        });
      } catch (err) {
        console.error('Error on disconnect:', err.message);
      }
    });
  });
};
