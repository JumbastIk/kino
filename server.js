// server.js

require('dotenv').config();                // загружаем SUPABASE_URL и SUPABASE_KEY из .env
const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const supabase   = require('./supabase');   // ваш клиент Supabase (createClient)

const app = express();

// --- Middlewares ---
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// --- API: получить данные комнаты ---
app.get('/api/rooms/:roomId', async (req, res) => {
  const { roomId } = req.params;
  try {
    const { data, error } = await supabase
      .from('rooms')
      .select('owner_id, movie_id')
      .eq('id', roomId)
      .single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({
      owner_id: data.owner_id,
      movie_id: data.movie_id
    });
  } catch (err) {
    console.error('[GET /api/rooms/:roomId]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- API: установить или обновить owner_id ---
app.post('/api/rooms/:roomId/set_owner', async (req, res) => {
  const { roomId }   = req.params;
  const { owner_id } = req.body;
  try {
    const { error } = await supabase
      .from('rooms')
      .update({ owner_id })
      .eq('id', roomId);
    if (error) return res.status(500).json({ error: error.message });
    res.sendStatus(200);
  } catch (err) {
    console.error('[POST /api/rooms/:roomId/set_owner]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- Создаём HTTP-сервер и Socket.io ---
const server = http.createServer(app);
const io = new Server(server, {
  path: '/socket.io',
  cors: { origin: '*' }
});

// --- Глобальное состояние для всех комнат (player sync + owner) ---
const roomsState = {}; // { [roomId]: { time, playing, speed, updatedAt, ownerId } }

/**
 * updatedAt — время последнего sync, для защиты от race conditions
 * ownerId — user_id владельца комнаты (создателя)
 */

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

      // --- История чата ---
      const { data: messages } = await supabase
        .from('messages')
        .select('author, text, created_at')
        .eq('room_id', roomId)
        .order('created_at', { ascending: true });
      socket.emit('history', messages);

      // --- Определяем owner комнаты ---
      let ownerId = null;
      // 1. Сначала — глобальный state
      if (roomsState[roomId] && roomsState[roomId].ownerId) {
        ownerId = roomsState[roomId].ownerId;
      } else {
        // 2. Потом — таблица rooms
        const { data: room } = await supabase
          .from('rooms')
          .select('owner_id')
          .eq('id', roomId)
          .single();
        ownerId = room?.owner_id || userId; // fallback на первого вошедшего
        if (!roomsState[roomId]) roomsState[roomId] = {};
        roomsState[roomId].ownerId = ownerId;
      }

      // --- Отправляем только что вошедшему sync_state с owner_id ---
      const state = roomsState[roomId] || {
        time: 0,
        playing: false,
        speed: 1,
        updatedAt: Date.now(),
        ownerId
      };
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
    // Отправляем состояние всем (owner_id всегда явно)
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
    const state = roomsState[roomId] || {
      time: 0,
      playing: false,
      speed: 1,
      updatedAt: Date.now()
    };
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

// --- Привязка к порту из Render: process.env.PORT или 10000 ---
const PORT = parseInt(process.env.PORT, 10) || 10000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on http://0.0.0.0:${PORT}`);
});
