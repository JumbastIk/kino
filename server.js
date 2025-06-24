// server.js

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  path: '/socket.io'
});

app.use(cors());
app.use(express.json());

// Подключение к API и заглушки для фронта
const rooms = {}; // { [roomId]: { ... } }
const movies = []; // заглушка под movies для примера

// API
app.get('/api/rooms', (req, res) => {
  res.json(Object.values(rooms));
});

app.get('/api/rooms/:id', (req, res) => {
  const room = rooms[req.params.id];
  if (!room) return res.status(404).json({ details: "Комната не найдена" });
  res.json(room);
});

app.post('/api/rooms', (req, res) => {
  const { title } = req.body;
  const id = Math.random().toString(36).substr(2, 9);
  const created_at = new Date();
  rooms[id] = { id, title, viewers: 1, created_at };
  res.json({ id });
  io.emit('room_created', rooms[id]);
});

// SOCKET.IO EVENTS
io.on('connection', (socket) => {
  socket.on('join', ({ roomId, userData }) => {
    if (rooms[roomId]) {
      rooms[roomId].viewers += 1;
      io.emit('room_updated', { id: roomId, viewers: rooms[roomId].viewers });
    }
    socket.join(roomId);
  });

  socket.on('player_action', (data) => {
    socket.to(data.roomId).emit('player_update', data);
  });

  socket.on('request_state', ({ roomId }) => {
    // Можно реализовать sync_state если требуется
  });

  socket.on('disconnect', () => {
    // Логика viewers по disconnect если нужно
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('Server listening on port', PORT);
});
