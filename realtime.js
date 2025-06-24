const supabase = require('./supabase');

// Глобальное состояние для всех комнат (player sync + owner)
const roomsState = {}; // { [roomId]: { time, playing, speed, updatedAt, ownerId } }

/**
 * updatedAt — время последнего sync, для защиты от race conditions
 * ownerId — user_id владельца комнаты (создателя)
 */

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

        // --- Участник вошёл в комнату ---
        await supabase.from('room_members')
          .upsert({ room_id: roomId, user_id: userId }, { onConflict: ['room_id','user_id'] });
        const { data: members } = await supabase
          .from('room_members')
          .select('user_id')
          .eq('room_id', roomId);
        io.to(roomId).emit('members', members);

        io.to(roomId).emit('system_message', {
          text:       `Человек вошёл в комнату`,
          created_at: new Date().toISOString()
        });

        const { data: messages } = await supabase
          .from('messages')
          .select('author, text, created_at')
          .eq('room_id', roomId)
          .order('created_at', { ascending: true });
        socket.emit('history', messages);

        // --- Определяем owner комнаты ---
        let ownerId = null;
        // 1. Пытаемся взять из state, если уже определён
        if (roomsState[roomId] && roomsState[roomId].ownerId) {
          ownerId = roomsState[roomId].ownerId;
        } else {
          // 2. Если нет — берём из таблицы rooms
          const { data: room } = await supabase
            .from('rooms')
            .select('owner_id')
            .eq('id', roomId)
            .single();
          ownerId = room?.owner_id || userId; // fallback на первого вошедшего
          if (!roomsState[roomId]) roomsState[roomId] = {};
          roomsState[roomId].ownerId = ownerId;
        }

        // Отправляем только что вошедшему sync_state с ownerId
        const state = roomsState[roomId] || { time: 0, playing: false, speed: 1, updatedAt: Date.now(), ownerId };
        socket.emit('sync_state', {
          position:  state.time,
          is_paused: !state.playing,
          speed:     state.speed,
          updatedAt: state.updatedAt || Date.now(),
          owner_id:  state.ownerId
        });
      } catch (err) {
        console.error('Socket join error:', err.message);
      }
    });

    // ===== Синхронизация плеера (play/pause/seek) =====
    socket.on('player_action', ({ roomId, position, is_paused, speed, updatedAt, userId }) => {
      // Только owner может управлять плеером!
      const ownerId = roomsState[roomId]?.ownerId;
      if (!ownerId || userId !== ownerId) {
        return; // Игнорируем не-owner'ов
      }
      const prev = roomsState[roomId] || {};
      if (prev.updatedAt && updatedAt && prev.updatedAt > updatedAt) {
        return;
      }
      roomsState[roomId] = {
        time:      position,
        playing:   !is_paused,
        speed:     speed || 1,
        updatedAt: updatedAt || Date.now(),
        ownerId:   ownerId
      };
      // Отправляем состояние с owner_id
      socket.to(roomId).emit('player_update', {
        position,
        is_paused,
        speed: speed || 1,
        updatedAt: roomsState[roomId].updatedAt,
        owner_id:  ownerId
      });
    });

    // ===== Получить актуальное состояние (после reconnection/request) =====
    socket.on('request_state', ({ roomId }) => {
      const state = roomsState[roomId] || { time: 0, playing: false, speed: 1, updatedAt: Date.now() };
      socket.emit('sync_state', {
        position:  state.time,
        is_paused: !state.playing,
        speed:     state.speed,
        updatedAt: state.updatedAt,
        owner_id:  state.ownerId
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
        await supabase.from('room_members')
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
