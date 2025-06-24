const supabase = require('./supabase');

// Глобальное состояние для всех комнат (player sync)
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

        // Обновляем участников
        await supabase
          .from('room_members')
          .upsert({ room_id: roomId, user_id: userId }, { onConflict: ['room_id','user_id'] });

        // Отправляем новый список участников
        const { data: members } = await supabase
          .from('room_members')
          .select('user_id')
          .eq('room_id', roomId);
        io.to(roomId).emit('members', members);

        // Системное сообщение
        io.to(roomId).emit('system_message', {
          text:       `Человек вошёл в комнату`,
          created_at: new Date().toISOString()
        });

        // История чата
        const { data: messages } = await supabase
          .from('messages')
          .select('author, text, created_at')
          .eq('room_id', roomId)
          .order('created_at', { ascending: true });
        socket.emit('history', messages);

        // Сразу отправляем sync_state только что вошедшему
        const state = roomsState[roomId] || { time: 0, playing: false, speed: 1, updatedAt: Date.now() };
        socket.emit('sync_state', {
          position:  state.time,
          is_paused: !state.playing,
          speed:     state.speed,
          updatedAt: state.updatedAt
        });
      } catch (err) {
        console.error('Socket join error:', err.message);
      }
    });

    // ===== Синхронизация плеера (play/pause/seek) =====
    socket.on('player_action', ({ roomId, position, is_paused, speed }) => {
      const prev = roomsState[roomId] || {};
      const isChanged =
        prev.time !== position ||
        prev.playing !== !is_paused ||
        prev.speed !== speed;
      if (isChanged) {
        roomsState[roomId] = {
          time:       position,
          playing:    !is_paused,
          speed:      speed || 1,
          updatedAt:  Date.now()
        };
        // Всем остальным участникам (кроме инициатора) отправляем новое состояние
        socket.to(roomId).emit('player_update', {
          position,
          is_paused,
          speed: speed || 1,
          updatedAt: roomsState[roomId].updatedAt
        });
      }
    });

    // ===== Получить актуальное состояние (после reconnection/request) =====
    socket.on('request_state', ({ roomId }) => {
      const state = roomsState[roomId] || { time: 0, playing: false, speed: 1, updatedAt: Date.now() };
      socket.emit('sync_state', {
        position:  state.time,
        is_paused: !state.playing,
        speed:     state.speed,
        updatedAt: state.updatedAt
      });
    });

    // ====== Чат ======
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
        console.error('chat_message error:', err.message);
      }
    });

    // ===== Отключение =====
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
          text:       `Человек вышел из комнаты`,
          created_at: new Date().toISOString()
        });
      } catch (err) {
        console.error('disconnect error:', err.message);
      }
    });
  });
};
