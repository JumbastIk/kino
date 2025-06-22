// server.js
require('dotenv').config();
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const supabase = require('./supabase');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

app.get('/api/rooms', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('rooms')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/rooms', async (req, res) => {
  try {
    const { title, movieId } = req.body;
    const id = Math.random().toString(36).substr(2, 9);
    const { error: insertError } = await supabase
      .from('rooms')
      .insert([{ id, title: title || 'Без названия', movie_id: movieId, viewers: 1 }]);
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
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/messages/:roomId', async (req, res) => {
  try {
    const roomId = req.params.roomId;
    const { data, error } = await supabase
      .from('messages')
      .select('author, text, created_at')
      .eq('room_id', roomId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    res.json(data);
  } catch (err) {
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
    res.status(500).json({ error: err.message });
  }
});

app.get(/^\/(?!api|socket\.io).*/, (req, res) => {
  const index = path.join(__dirname, 'index.html');
  if (fs.existsSync(index)) return res.sendFile(index);
  res.status(404).send('index.html not found');
});

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const roomsState = {};  // { [roomId]: { time, playing, speed, lastUpdate } }

io.on('connection', socket => {
  let currentRoom = null;
  let userId = null;

  socket.on('join', async ({ roomId, userData }) => {
    currentRoom = roomId;
    userId = userData.id;
    socket.join(roomId);

    await supabase
      .from('room_members')
      .upsert({ room_id: roomId, user_id: userId }, { onConflict: ['room_id','user_id'] });

    const { data: members } = await supabase
      .from('room_members')
      .select('user_id')
      .eq('room_id', roomId);
    io.to(roomId).emit('members', members.map(m => m.user_id));

    socket.emit(
      'history',
      (await supabase
        .from('messages')
        .select('author,text,created_at')
        .eq('room_id', roomId)
        .order('created_at', { ascending: true })
      ).data
    );

    const state = roomsState[roomId] || { position: 0, is_paused: true };
    socket.emit('sync_state', state);
  });

  socket.on('chat_message', async msg => {
    await supabase.from('messages').insert([{
      room_id: msg.roomId,
      author:  msg.author,
      text:    msg.text
    }]);
    io.to(msg.roomId).emit('chat_message', {
      author: msg.author,
      text: msg.text,
      created_at: new Date().toISOString()
    });
  });

  socket.on('player_action', ({ roomId, position, is_paused }) => {
    roomsState[roomId] = {
      position,
      is_paused,
      lastUpdate: Date.now()
    };
    socket.to(roomId).emit('player_update', { position, is_paused });
  });

  socket.on('request_state', ({ roomId }) => {
    const state = roomsState[roomId] || { position: 0, is_paused: true };
    socket.emit('current_state', state);
  });

  socket.on('disconnect', async () => {
    if (!currentRoom || !userId) return;
    await supabase
      .from('room_members')
      .delete()
      .match({ room_id: currentRoom, user_id: userId });

    const { data: members } = await supabase
      .from('room_members')
      .select('user_id')
      .eq('room_id', currentRoom);
    io.to(currentRoom).emit('members', members.map(m => m.user_id));
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server started on ${PORT}`));
