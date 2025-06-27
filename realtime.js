// realtime.js

const supabase = require('./supabase');

// Server-side state: roomsState[roomId] = { time, playing, speed, updatedAt }
const roomsState      = {};
// Broadcast timers per room
const broadcastTimers = {};
// Interval for background sync (ms)
const BROADCAST_INTERVAL = 500;  // было 2000, стало 500

// Start periodic broadcast of predicted state for a room
function scheduleBroadcast(io, roomId) {
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
  }, BROADCAST_INTERVAL);
}

// Stop broadcast when room is empty
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

    // ===== User joins room =====
    socket.on('join', async ({ roomId, userData }) => {
      try {
        currentRoom = roomId;
        userId      = userData.id;
        socket.join(roomId);

        // Update members in supabase…
        await supabase
          .from('room_members')
          .upsert(
            { room_id: roomId, user_id: userId },
            { onConflict: ['room_id','user_id'] }
          );
        const { data: members } = await supabase
          .from('room_members')
          .select('user_id')
          .eq('room_id', roomId);
        io.to(roomId).emit('members', members);

        // System join message
        io.to(roomId).emit('system_message', {
          text:       'Пользователь вошёл в комнату',
          created_at: new Date().toISOString()
        });

        // Chat history
        const { data: messages } = await supabase
          .from('messages')
          .select('author, text, created_at')
          .eq('room_id', roomId)
          .order('created_at', { ascending: true });
        socket.emit('history', messages);

        // Initialize room state if first user
        if (!roomsState[roomId]) {
          roomsState[roomId] = {
            time:      0,
            playing:   false,
            speed:     1,
            updatedAt: Date.now()
          };
        }

        // Immediately send current state (sync_state)
        const s = roomsState[roomId];
        socket.emit('sync_state', {
          position:  s.time,
          is_paused: !s.playing,
          speed:     s.speed,
          updatedAt: s.updatedAt
        });

        // (Re)start periodic broadcast
        clearBroadcast(io, roomId);
        scheduleBroadcast(io, roomId);

      } catch (err) {
        console.error('Error on join:', err.message);
      }
    });

    // ===== Ping-pong for RTT =====
    socket.on('ping', () => {
      socket.emit('pong');
    });

    // ===== On explicit state request =====
    // (клиент уже не должен дергать, но оставим на всякий)
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

    // ===== Handle play/pause/seek =====
    socket.on('player_action', ({ roomId, pos, is_paused, speed }) => {
      const now = Date.now();

      // Update authoritative state
      roomsState[roomId] = {
        time:      pos,
        playing:   !is_paused,
        speed:     speed || 1,
        updatedAt: now
      };

      // Сразу шлём единообразный sync_state:
      io.to(roomId).emit('sync_state', {
        position:  pos,
        is_paused,
        speed:     speed || 1,
        updatedAt: now
      });

      // Перезапуск broadcast
      clearBroadcast(io, roomId);
      scheduleBroadcast(io, roomId);
    });

    // ===== Chat messages =====
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

    // ===== User disconnects =====
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
          text:       'Пользователь вышел из комнаты',
          created_at: new Date().toISOString()
        });

        clearBroadcast(io, currentRoom);
      } catch (err) {
        console.error('Error on disconnect:', err.message);
      }
    });
  });
};
