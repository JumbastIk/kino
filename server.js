const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const cors = require('cors');
const mysql = require('mysql2/promise');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// ====== ПОДКЛЮЧЕНИЕ К MySQL ======
const db = mysql.createPool({
  host: 'localhost', // или ваш хост на хостинге
  user: 'u317143_jumbastik', // ваш пользователь
  password: 'shelby753753/',    // ваш пароль
  database: 'u317143_jumbastik' // ваша база
});

// ====== API для списка комнат ======
// Получить список комнат
app.get('/api/rooms', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM rooms ORDER BY created_at DESC');
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'DB error', details: e.message });
  }
});

// Создать комнату
app.post('/api/rooms', async (req, res) => {
  try {
    const { title } = req.body;
    const id = Math.random().toString(36).substr(2, 9);
    await db.query(
      'INSERT INTO rooms (id, title, viewers) VALUES (?, ?, ?)',
      [id, title || 'Без названия', 1]
    );
    res.json({ id });
  } catch (e) {
    res.status(500).json({ error: 'DB error', details: e.message });
  }
});

// ====== SOCKET.IO для синхронизации ======
io.on('connection', (socket) => {
  let currentRoom = null;
  let user = null;

  socket.on('join', async ({ roomId, userData }) => {
    currentRoom = roomId;
    user = userData;
    socket.join(roomId);

    // Увеличиваем viewers в базе
    try {
      await db.query('UPDATE rooms SET viewers = viewers + 1 WHERE id = ?', [roomId]);
      const [rows] = await db.query('SELECT viewers FROM rooms WHERE id = ?', [roomId]);
      io.to(roomId).emit('users', rows[0]?.viewers || 1);
    } catch {}

    // Можно добавить sync state через отдельную таблицу, если нужно
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
      } catch {}
    }
  });
});

server.listen(3000, () => {
  console.log('Socket.io/Express server started on port 3000');
});