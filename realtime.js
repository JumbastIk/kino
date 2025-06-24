const supabase = require('./supabase');

const roomsState = {};

module.exports = function(io) {
  io.on('connection', socket => {
    let currentRoom = null;
    let userId      = null;

    // Новый пользователь заходит в комнату
    socket.on('join', async ({ roomId, userData }) => {
      try {
        currentRoom = roomId;
        userId      = userData.id;
        socket.join(roomId);

        // Добавляем/обновляем участника
        await supabase
          .from('room_members')
          .upsert({ room_id: roomId, user_id: userId }, { onConflict: ['room_id','user_id'] });

        // Обновлённый список участников
        const { data: members } = await supabase
          .from('room_members')
          .select('user_id')
          .eq('room_id', roomId);
        io.to(roomId).emit('members', members);

        // Сообщение "Человек вошёл в комнату"
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

        // Критически важно: СРАЗУ отправляем sync_state нового пользователя
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

    // Чат
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

    // События управления плеером (play/pause/seek)
    socket.on('player_action', ({ roomId, position, is_paused, speed }) => {
      // Проверяем был ли реально сдвиг
      const prev = roomsState[roomId] || {};
      const isChanged = (
        prev.time !== position ||
        prev.playing !== !is_paused ||
        prev.speed !== speed
      );
      // Обновляем только если реально что-то поменялось
      if (isChanged) {
        roomsState[roomId] = {
          time:       position,
          playing:    !is_paused,
          speed:      speed || 1,
          updatedAt:  Date.now()
        };
        // Шлём ВСЕМ кроме инициатора
        socket.to(roomId).emit('player_update', {
          position,
          is_paused,
          speed: speed || 1,
          updatedAt: roomsState[roomId].updatedAt
        });
      }
    });

    // Новый участник, или сбой — всегда можно запросить актуальное состояние
    socket.on('request_state', ({ roomId }) => {
      const state = roomsState[roomId] || { time: 0, playing: false, speed: 1, updatedAt: Date.now() };
      socket.emit('sync_state', {
        position:  state.time,
        is_paused: !state.playing,
        speed:     state.speed,
        updatedAt: state.updatedAt
      });
    });

    // При отключении пользователя
    socket.on('disconnect', async () => {
      try {
        if (!currentRoom || !userId) return;

        // Удаляем участника
        await supabase
          .from('room_members')
          .delete()
          .match({ room_id: currentRoom, user_id: userId });

        // Новый список участников
        const { data: members } = await supabase
          .from('room_members')
          .select('user_id')
          .eq('room_id', currentRoom);
        io.to(currentRoom).emit('members', members);

        // Сообщение "Человек вышел из комнаты"
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
