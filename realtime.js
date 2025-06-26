// realtime.js

const supabase = require('./supabase');

// Server-side state: roomsState[roomId] = { time, playing, speed, updatedAt }
const roomsState      = {};
// Broadcast timers per room
const broadcastTimers = {};
// Interval for background sync (ms)
const BROADCAST_INTERVAL = 2000;

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

        // Update members table
        await supabase
          .from('room_members')
          .upsert(
            { room_id: roomId, user_id: userId },
            { onConflict: ['room_id','user_id'] }
          );

        // Broadcast updated members list
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

        // Initialize room state if first
        if (!roomsState[roomId]) {
          roomsState[roomId] = {
            time:      0,
            playing:   false,
            speed:     1,
            updatedAt: Date.now()
          };
        }

        // Immediately send current state
        const s = roomsState[roomId];
        socket.emit('sync_state', {
          position:  s.time,
          is_paused: !s.playing,
          speed:     s.speed,
          updatedAt: s.updatedAt
        });

        // (Re)start background broadcast
        clearBroadcast(io, roomId);
        scheduleBroadcast(io, roomId);

      } catch (err) {
        console.error('Error on join:', err.message);
      }
    });

    // ===== On explicit state request =====
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

    // ===== Ping-pong for RTT =====
    socket.on('ping', () => {
      socket.emit('pong');
    });

    // ===== Handle play/pause/seek =====
    socket.on('player_action', ({ roomId, position, is_paused, speed }) => {
      const now = Date.now();

      // Update authoritative state
      roomsState[roomId] = {
        time:      position,
        playing:   !is_paused,
        speed:     speed || 1,
        updatedAt: now
      };

      // Immediately broadcast to all
      io.to(roomId).emit('player_update', {
        position,
        is_paused,
        speed:     speed || 1,
        updatedAt: now
      });

      // Reset background broadcast timer
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
