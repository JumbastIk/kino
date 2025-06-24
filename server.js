require('dotenv').config();
const http      = require('http');
const express   = require('express');
const { Server } = require('socket.io');
const cors      = require('cors');
const path      = require('path');
const fs        = require('fs');
const supabase  = require('./supabase');

const app = express();

app.use(cors({
  origin: [
    'https://kino-fhwp.onrender.com',
    'https://dsgsasd.ru',
    'https://www.dsgsasd.ru',
    'https://web.telegram.org'
  ],
  methods: ['GET','POST','OPTIONS'],
  allowedHeaders: ['Content-Type'],
  credentials: true
}));
app.options('*', cors());

app.use(express.json());
app.use(express.static(__dirname));

// ==== Получить список комнат ====
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

// ==== Получить комнату по ID ====
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

// ==== Создать комнату ====
// Теперь ownerId принимается из req.body (userId создателя)
app.post('/api/rooms', async (req, res) => {
  try {
    const { title, movieId, ownerId } = req.body;
    const id = Math.random().toString(36).substring(2, 11);

    const { error: insertError } = await supabase
      .from('rooms')
      .insert([{
        id,
        title:    title || 'Без названия',
        movie_id: movieId,
        viewers:  1,
        owner_id: ownerId // Сохраняем владельца комнаты!
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

// ==== Сообщения чата ====
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

// ==== SPA (Single Page App) fallback ====
app.get(/^\/(?!api|socket\.io).*/, (req, res) => {
  const index = path.join(__dirname, 'index.html');
  if (fs.existsSync(index)) return res.sendFile(index);
  res.status(404).send('index.html not found');
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: [
      'https://kino-fhwp.onrender.com',
      'https://dsgsasd.ru',
      'https://www.dsgsasd.ru',
      'https://web.telegram.org'
    ],
    methods: ['GET','POST'],
    credentials: true
  }
});

// ==== Подключение realtime.js для socket.io (логика комнат) ====
require('./realtime')(io);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server started on port ${PORT}`));
