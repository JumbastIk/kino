// server.js

require('dotenv').config();
const http    = require('http');
const express = require('express');
const { Server } = require('socket.io');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');
const supabase = require('./supabase');

const app = express();

// Разрешаем CORS только с наших доменов и Telegram WebView
app.use(cors({
  origin: [
    'https://kino-fhwp.onrender.com',
    'https://dsgsasd.ru',
    'https://web.telegram.org'
  ],
  credentials: true
}));

app.use(express.json());
app.use(express.static(__dirname));

// — API для комнат —
app.get('/api/rooms', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('rooms')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('GET /api/rooms error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/rooms/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('rooms')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('GET /api/rooms/:id error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/rooms', async (req, res) => {
  try {
    const { title, movieId } = req.body;
    const id = Math.random().toString(36).substring(2, 11);
    const { error: insertError } = await supabase
      .from('rooms')
      .insert([{
        id,
        title: title || 'Без названия',
        movie_id: movieId,
        viewers: 1
      }]);
    if (insertError) throw insertError;

    const { data: newRoom, error: selErr } = await supabase
      .from('rooms')
      .select('*')
      .eq('id', id)
      .single();
    if (selErr) throw selErr;

    io.emit('room_created', newRoom);
    res.json({ id });
  } catch (err) {
    console.error('POST /api/rooms error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// — API для чата —
app.get('/api/messages/:roomId', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('messages')
      .select('author, text, created_at')
      .eq('room_id', req.params.roomId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('GET /api/messages error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/messages', async (req, res) => {
  try {
    const { room_id, author, text } = req.body;
    const { error } = await supabase
      .from('messages')
      .insert([{ room_id, author, text }]);
    if (error) throw error;
    res.json({ status: 'ok' });
  } catch (err) {
    console.error('POST /api/messages error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// — SPA fallback — должен быть в конце
app.get(/^\/(?!api|socket\.io).*/, (req, res) => {
  const index = path.join(__dirname, 'index.html');
  if (fs.existsSync(index)) {
    return res.sendFile(index);
  }
  res.status(404).send('index.html not found');
});

// Создаём HTTP и WebSocket сервер
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: [
      'https://kino-fhwp.onrender.com',
      'https://dsgsasd.ru',
      'https://web.telegram.org'
    ],
    methods: ['GET','POST'],
    credentials: true
  }
});

const roomsState = {};

io.on('connection', socket => {
  let currentRoom = null;
  let userId      = null;

  socket.on('join', async ({ roomId, userData }) => {
    try {
      currentRoom = roomId;
      userId      = userData.id;
      socket.join(roomId);

      // Сохраняем в БД не только user_id, но и user_name
      await supabase
        .from('room_members')
        .upsert({
          room_id:   roomId,
          user_id:   userId,
          user_name: userData.first_name
        }, { onConflict: ['room_id','user_id'] });

      // Выбираем всех участников с именами
      const { data: members, error: membersError } = await supabase
        .from('room_members')
        .select('user_id, user_name')
        .eq('room_id', roomId);

      if (!membersError) {
        io.to(roomId).emit('members', members);
      }

      // История чата
      const { data: messages, error: messagesError } = await supabase
        .from('messages')
        .select('author, text, created_at')
        .eq('room_id', roomId)
        .order('created_at', { ascending: true });

      if (!messagesError) {
        socket.emit('history', messages);
      }

      // Синхронизируем состояние плеера
      const state = roomsState[roomId] || { time: 0, playing: false, speed: 1 };
      socket.emit('sync_state', {
        position: state.time,
        is_paused: !state.playing,
        speed: state.speed
      });
    } catch (err) {
      console.error('Socket join error:', err.message);
    }
  });

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

  socket.on('player_action', ({ roomId, position, is_paused, speed }) => {
    roomsState[roomId] = {
      time:       position,
      playing:   !is_paused,
      speed,
      lastUpdate: Date.now()
    };
    socket.to(roomId).emit('player_update', { position, is_paused, speed });
  });

  socket.on('request_state', ({ roomId }) => {
    const state = roomsState[roomId] || { time: 0, playing: false, speed: 1 };
    // Отправляем обратно именно 'sync_state'
    socket.emit('sync_state', {
      position: state.time,
      is_paused: !state.playing,
      speed: state.speed
    });
  });

  socket.on('disconnect', async () => {
    try {
      if (!currentRoom || !userId) return;

      // Убираем из room_members
      await supabase
        .from('room_members')
        .delete()
        .match({ room_id: currentRoom, user_id: userId });

      // Шлём обновлённый список участников
      const { data: members } = await supabase
        .from('room_members')
        .select('user_id, user_name')
        .eq('room_id', currentRoom);
      io.to(currentRoom).emit('members', members);
    } catch (err) {
      console.error('disconnect error:', err.message);
    }
  });
});

// Запуск
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
});
