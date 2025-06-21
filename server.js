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

const supabase = createClient(
  'https://cmworinijkexswnjdhao.supabase.co',
  'YOUR_SUPABASE_KEY'
);

// ——————————————————————————————
// API для комнат (без изменений)
// :contentReference[oaicite:4]{index=4}
app.get('/api/rooms', async (req, res) => { /* … */ });
app.post('/api/rooms', async (req, res) => { /* … */ });
// ——————————————————————————————

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// Храним состояние плеера для каждой комнаты в памяти
const roomsState = {}; // { [roomId]: { videoId, time, playing, speed, lastUpdate } }

io.on('connection', socket => {
  let currentRoom = null;

  socket.on('join', async ({ roomId, userData }) => {
    currentRoom = roomId;
    socket.join(roomId);

    // Увеличиваем счётчик зрителей, отсылаем users…
    /* :contentReference[oaicite:5]{index=5} */

    // А теперь отсылаем **состояние плеера** только что зашедшему:
    const state = roomsState[roomId] || {
      videoId: null, time: 0, playing: false, speed: 1, lastUpdate: Date.now()
    };
    socket.emit('syncState', state);
  });

  // Клиент нажал «play»
  socket.on('play', ({ time, speed }) => {
    if (!currentRoom) return;
    roomsState[currentRoom] = {
      ...roomsState[currentRoom],
      time,
      playing: true,
      speed: speed || 1,
      lastUpdate: Date.now()
    };
    // Рассылаем остальным:
    socket.to(currentRoom).emit('play', { time, speed, timestamp: Date.now() });
  });

  // Клиент нажал «pause»
  socket.on('pause', ({ time }) => {
    if (!currentRoom) return;
    roomsState[currentRoom] = {
      ...roomsState[currentRoom],
      time,
      playing: false,
      lastUpdate: Date.now()
    };
    socket.to(currentRoom).emit('pause', { time, timestamp: Date.now() });
  });

  // Клиент перемотал (seek)
  socket.on('seek', ({ time }) => {
    if (!currentRoom) return;
    roomsState[currentRoom] = {
      ...roomsState[currentRoom],
      time,
      lastUpdate: Date.now()
    };
    socket.to(currentRoom).emit('seek', { time, timestamp: Date.now() });
  });

  // Клиент сменил видео
  socket.on('changeVideo', ({ videoId }) => {
    if (!currentRoom) return;
    roomsState[currentRoom] = {
      videoId,
      time: 0,
      playing: false,
      speed: 1,
      lastUpdate: Date.now()
    };
    io.to(currentRoom).emit('changeVideo', roomsState[currentRoom]);
  });

  socket.on('disconnect', async () => {
    if (currentRoom) {
      // Уменьшаем счётчик зрителей…
      /* :contentReference[oaicite:6]{index=6} */
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Server on port', PORT));
