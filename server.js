const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// === Подключение к Supabase ===
const supabase = createClient(
  'https://cmworinijkexswnjdhao.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNtd29yaW5pamtleHN3bmpkaGFvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTA1MDU0OTcsImV4cCI6MjA2NjA4MTQ5N30.qd3ns6_nQIhbAGWdXIE16h26AR9Td14OusfCr5x8G1I'
);

// === API для списка комнат ===
app.get('/api/rooms', async (req, res) => {
  try {
    console.log('[GET] /api/rooms');
    const { data, error } = await supabase
      .from('rooms')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data);
  } catch (e) {
    console.error('[ERROR][GET] /api/rooms:', e);
    res.status(500).json({ error: 'DB error', details: e.message });
  }
});

// === Создание комнаты ===
app.post('/api/rooms', async (req, res) => {
  try {
    const { title, movieId } = req.body;
    const id = Math.random().toString(36).substr(2, 9);
    console.log('[POST] /api/rooms', { id, title, movieId });

    const { error: insertError } = await supabase.from('rooms').insert([
      {
        id,
        title: title || 'Без названия',
        movie_id: movieId || null,
        viewers: 1,
        created_at: new Date().toISOString()
      }
    ]);

    if (insertError) throw insertError;

    const { data: newRoom } = await supabase
      .from('rooms')
      .select('*')
      .eq('id', id)
      .single();

    if (newRoom) {
      console.log('[SOCKET] room_created', newRoom);
      io.emit('room_created', newRoom);
    }

    res.json({ id });
  } catch (e) {
    console.error('[ERROR][POST] /api/rooms:', e);
    res.status(500).json({ error: 'DB error', details: e.message });
  }
});

// === SPA fallback для index.html ===
app.get(/^\/(?!api|socket\.io).*/, (req, res) => {
  const indexPath = path.join(__dirname, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send('index.html not found');
  }
});

// === SOCKET.IO для синхронизации ===
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

io.on('connection', (socket) => {
  let currentRoom = null;
  let user = null;

  console.log('[SOCKET] client connected:', socket.id);

  socket.on('join', async ({ roomId, userData }) => {
    currentRoom = roomId;
    user = userData;
    socket.join(roomId);

    try {
      const { error: updateError } = await supabase.rpc('increment_viewers', { room_id: roomId });
      if (updateError) throw updateError;

      const { data: roomData } = await supabase
        .from('rooms')
        .select('viewers')
        .eq('id', roomId)
        .single();

      io.to(roomId).emit('users', roomData?.viewers || 1);
    } catch (e) {
      console.error('[ERROR][SOCKET][join]:', e);
    }

    socket.emit('sync', { time: 0, paused: true });
  });

  socket.on('sync', (state) => {
    if (currentRoom) {
      socket.to(currentRoom).emit('sync', state);
    }
  });

  socket.on('disconnect', async () => {
    if (currentRoom) {
      try {
        const { error: decError } = await supabase.rpc('decrement_viewers', { room_id: currentRoom });
        if (decError) throw decError;

        const { data: roomData } = await supabase
          .from('rooms')
          .select('viewers')
          .eq('id', currentRoom)
          .single();

        io.to(currentRoom).emit('users', roomData?.viewers || 0);
      } catch (e) {
        console.error('[ERROR][SOCKET][disconnect]:', e);
      }
    }
    console.log('[SOCKET] client disconnected:', socket.id);
  });
});

// Запуск сервера
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('Socket.io/Express server started on port', PORT);
});
