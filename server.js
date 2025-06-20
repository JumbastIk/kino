const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const cors = require('cors');
const mysql = require('mysql2/promise');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());

// Раздача статики (HTML, CSS, JS, картинки)
app.use(express.static(__dirname));

// ====== ПОДКЛЮЧЕНИЕ К MySQL ======
const db = mysql.createPool({
  host: 'server292.hosting.reg.ru',
  user: 'u317143_jumbastik',
  password: 'shelby753753/',
  database: 'u317143_jumbastik'
});

// ====== API для списка комнат ======
app.get('/api/rooms', async (req, res) => {
  try {
    console.log('[GET] /api/rooms');
    const [rows] = await db.query('SELECT * FROM rooms ORDER BY created_at DESC');
    res.json(rows);
  } catch (e) {
    console.error('[ERROR][GET] /api/rooms:', e);
    res.status(500).json({ error: 'DB error', details: e.message });
  }
});

app.post('/api/rooms', async (req, res) => {
  try {
    const { title } = req.body;
    const id = Math.random().toString(36).substr(2, 9);
    console.log('[POST] /api/rooms', { id, title });
    await db.query(
      'INSERT INTO rooms (id, title, viewers) VALUES (?, ?, ?)',
      [id, title || 'Без названия', 1]
    );
    const [rows] = await db.query('SELECT * FROM rooms WHERE id = ?', [id]);
    if (rows[0]) {
      console.log('[SOCKET] room_created', rows[0]);
      io.emit('room_created', rows[0]);
    }
    res.json({ id });
  } catch (e) {
    console.error('[ERROR][POST] /api/rooms:', e);
    res.status(500).json({ error: 'DB error', details: e.message });
  }
});

// ====== SPA fallback: отдаём index.html для всех не-API и не-статических GET ======
app.get(/^\/(?!api|socket\.io).*/, (req, res) => {
  const indexPath = path.join(__dirname, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send('index.html not found');
  }
});

// ====== SOCKET.IO для синхронизации ======
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
      await db.query('UPDATE rooms SET viewers = viewers + 1 WHERE id = ?', [roomId]);
      const [rows] = await db.query('SELECT viewers FROM rooms WHERE id = ?', [roomId]);
      io.to(roomId).emit('users', rows[0]?.viewers || 1);
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
        await db.query('UPDATE rooms SET viewers = GREATEST(viewers - 1, 0) WHERE id = ?', [currentRoom]);
        const [rows] = await db.query('SELECT viewers FROM rooms WHERE id = ?', [currentRoom]);
        io.to(currentRoom).emit('users', rows[0]?.viewers || 0);
      } catch (e) {
        console.error('[ERROR][SOCKET][disconnect]:', e);
      }
    }
    console.log('[SOCKET] client disconnected:', socket.id);
  });
});

// Используем порт из переменной окружения (важно для Render!)
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('Socket.io/Express server started on port', PORT);
});