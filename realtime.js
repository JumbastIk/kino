const supabase = require('./supabase');

const roomsState = {};
const broadcastTimers = {};
const BROADCAST_INTERVAL = 20000; // 20 секунд

// Доп параметры для ловли sync-loop
const SYNC_LOOP_WINDOW = 1000; // 1 сек
const SYNC_LOOP_THRESHOLD = 5;
const SYNC_BLOCK_MS = 1200;
const syncLoopHistory = {};
const syncBlockUntil = {};

// --- Расчет позиции для комнаты (учитывает play/pause/speed) ---
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

// --- План Б: восстановление состояния если sync зациклился ---
function shouldForceRecover(roomId) {
  const now = Date.now();
  if (!syncLoopHistory[roomId]) syncLoopHistory[roomId] = [];
  syncLoopHistory[roomId].push(now);
  syncLoopHistory[roomId] = syncLoopHistory[roomId].filter(t => now - t < SYNC_LOOP_WINDOW);
  if (syncLoopHistory[roomId].length > SYNC_LOOP_THRESHOLD) {
    syncBlockUntil[roomId] = now + SYNC_BLOCK_MS;
    syncLoopHistory[roomId] = [];
    return true;
  }
  return false;
}
function isSyncBlocked(roomId) {
  return false; // <--- Фикс, теперь play/pause всегда разрешён
}

function scheduleBroadcast(io, roomId) {
  if (broadcastTimers[roomId]) return;
  broadcastTimers[roomId] = setInterval(() => {
    const syncData = calculatePosition(roomId);
    io.to(roomId).emit('sync_state', syncData);
    console.log(`[Broadcast] sync_state to room ${roomId}`, syncData);
  }, BROADCAST_INTERVAL);
  console.log(`[Schedule] Started broadcast timer for room ${roomId}`);
}

function clearBroadcast(io, roomId) {
  const room = io.sockets.adapter.rooms.get(roomId);
  if (!room || room.size === 0) {
    clearInterval(broadcastTimers[roomId]);
    delete broadcastTimers[roomId];
    delete syncLoopHistory[roomId];
    delete syncBlockUntil[roomId];
    console.log(`[Clear] Stopped broadcast timer and cleared state for room ${roomId}`);
  }
}

module.exports = function (io) {
  io.on('connection', socket => {
    let currentRoom = null;
    let userId = null;

    socket.on('join', async ({ roomId, userData }) => {
      try {
        currentRoom = roomId;
        userId = userData.id;
        socket.join(roomId);
        console.log(`[Join] User ${userId} joined room ${roomId}`);

        await supabase.from('room_members').upsert(
          { room_id: roomId, user_id: userId },
          { onConflict: ['room_id', 'user_id'] }
        );

        const { data: members } = await supabase
          .from('room_members')
          .select('user_id')
          .eq('room_id', roomId);
        io.to(roomId).emit('members', members);

        io.to(roomId).emit('system_message', {
          text: 'Пользователь вошёл в комнату',
          created_at: new Date().toISOString()
        });

        const { data: messages } = await supabase
          .from('messages')
          .select('author, text, created_at')
          .eq('room_id', roomId)
          .order('created_at', { ascending: true });
        socket.emit('history', messages);

        if (!roomsState[roomId]) {
          roomsState[roomId] = {
            time: 0,
            playing: false,
            speed: 1,
            updatedAt: Date.now()
          };
          console.log(`[Init] Initialized state for room ${roomId}`);
        }

        // Синхронизация при входе
        socket.emit('sync_state', calculatePosition(roomId));
        scheduleBroadcast(io, roomId);

      } catch (err) {
        console.error('[Join Error]', err.message);
      }
    });

    socket.on('request_state', ({ roomId }) => {
      console.log(`[Request State] for room ${roomId}`);
      const syncData = calculatePosition(roomId);
      socket.emit('sync_state', syncData);
    });

    socket.on('ping', () => socket.emit('pong'));

    // --- sync_state: любое действие пользователя рассылается всем! ---
    socket.on('player_action', ({ roomId, position, is_paused, speed }) => {
      try {
        // Если sync-loop, то форсим корректное состояние и блокируем излишние sync
        if (shouldForceRecover(roomId)) {
          console.log(`[ForceRecover][PLAYER_ACTION][LOOP] room=${roomId}`);
          const now = Date.now();
          roomsState[roomId] = {
            time: position,
            playing: !is_paused,
            speed: speed || 1,
            updatedAt: now
          };
          const forcedData = {
            position,
            is_paused,
            speed: speed || 1,
            updatedAt: now
          };
          io.to(roomId).emit('sync_state', forcedData);
          return;
        }

        if (isSyncBlocked(roomId)) {
          // Теперь всегда false, блокировка отключена!
          return;
        }

        if (typeof position !== 'number' || position < 0) {
          console.warn(`[Player Action][BAD POSITION]`, position);
          return;
        }

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

        io.to(roomId).emit('sync_state', updateData);

      } catch (err) {
        console.error('[Player Action Error]', err.message);
      }
    });

    socket.on('chat_message', async msg => {
      try {
        await supabase.from('messages').insert([{
          room_id: msg.roomId,
          author: msg.author,
          text: msg.text
        }]);
        const chatMsg = {
          author: msg.author,
          text: msg.text,
          created_at: new Date().toISOString()
        };
        io.to(msg.roomId).emit('chat_message', chatMsg);
        console.log(`[Chat Message] in room ${msg.roomId}`, chatMsg);
      } catch (err) {
        console.error('[Chat Error]', err.message);
      }
    });

    socket.on('update_time', data => {
      // data = { roomId, user_id, currentTime, ping }
      io.to(data.roomId).emit('user_time_update', data);
    });

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
