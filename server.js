// server.js
require('dotenv').config()       // если используете .env для ключей
const http    = require('http')
const express = require('express')
const { Server } = require('socket.io')
const cors    = require('cors')
const path    = require('path')
const fs      = require('fs')

// ваш модуль supabase.js, где создаётся и экспортируется клиент
const supabase = require('./supabase')

const app = express()
app.use(cors())
app.use(express.json())
app.use(express.static(__dirname))

// — API для комнат (осталось без изменений) —
// GET  /api/rooms
app.get('/api/rooms', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('rooms')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) throw error
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})
// POST /api/rooms
app.post('/api/rooms', async (req, res) => {
  try {
    const { title, movieId } = req.body
    const id = Math.random().toString(36).substr(2, 9)
    const { error: insertError } = await supabase
      .from('rooms')
      .insert([{ id, title: title||'Без названия', movie_id: movieId, viewers: 1 }])
    if (insertError) throw insertError
    const { data: newRoom, error: selErr } = await supabase
      .from('rooms')
      .select('*')
      .eq('id', id)
      .single()
    if (selErr) throw selErr
    io.emit('room_created', newRoom)
    res.json({ id })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// — API для чата —
// GET  /api/messages/:roomId
app.get('/api/messages/:roomId', async (req, res) => {
  try {
    const roomId = req.params.roomId
    const { data, error } = await supabase
      .from('messages')
      .select('author, text, created_at')
      .eq('room_id', roomId)
      .order('created_at', { ascending: true })
    if (error) throw error
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})
// POST /api/messages
app.post('/api/messages', async (req, res) => {
  try {
    const { room_id, author, text } = req.body
    const { error } = await supabase
      .from('messages')
      .insert([{ room_id, author, text }])
    if (error) throw error
    res.json({ status: 'ok' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// — SPA-fallback —
app.get(/^\/(?!api|socket\.io).*/, (req, res) => {
  const index = path.join(__dirname, 'index.html')
  if (fs.existsSync(index)) return res.sendFile(index)
  res.status(404).send('index.html not found')
})

const server = http.createServer(app)
const io     = new Server(server, { cors: { origin: '*' } })

// Храним состояние плеера в памяти:
const roomsState = {}  // { [roomId]: { time, playing, speed, ... } }

io.on('connection', socket => {
  let currentRoom = null
  let userId      = null

  socket.on('join', async ({ roomId, userData }) => {
    currentRoom = roomId
    userId      = userData.id
    socket.join(roomId)

    // добавляем в room_members
    await supabase
      .from('room_members')
      .upsert({ room_id: roomId, user_id: userId }, { onConflict: ['room_id','user_id'] })

    // шлём всем в комнате список участников
    const { data: members } = await supabase
      .from('room_members')
      .select('user_id')
      .eq('room_id', roomId)
    io.to(roomId).emit('members', members.map(m=>m.user_id))

    // отправляем новичку историю чата
    socket.emit(
      'history', 
      (await supabase
        .from('messages')
        .select('author,text,created_at')
        .eq('room_id', roomId)
        .order('created_at',{ascending:true})
      ).data
    )

    // отправляем новичку текущее состояние плеера
    const state = roomsState[roomId] || { time:0,playing:false,speed:1 }
    socket.emit('sync_state', state)
  })

  socket.on('chat_message', async msg => {
    // msg = { roomId, author, text }
    await supabase.from('messages').insert([{
      room_id: msg.roomId,
      author:  msg.author,
      text:    msg.text
    }])
    io.to(msg.roomId).emit('chat_message', { author: msg.author, text: msg.text })
  })

  // плеер
  socket.on('player_action', ({ roomId, position, is_paused, speed }) => {
    roomsState[roomId] = { time: position, playing: !is_paused, speed, lastUpdate: Date.now() }
    socket.to(roomId).emit('player_update', { position, is_paused, speed })
  })

  socket.on('disconnect', async () => {
    if (!currentRoom || !userId) return
    // удаляем из room_members (или помечаем ушедшим)
    await supabase
      .from('room_members')
      .delete()
      .match({ room_id: currentRoom, user_id: userId })

    // обновляем список участников
    const { data: members } = await supabase
      .from('room_members')
      .select('user_id')
      .eq('room_id', currentRoom)
    io.to(currentRoom).emit('members', members.map(m=>m.user_id))
  })
})

const PORT = process.env.PORT || 3000
server.listen(PORT, ()=>console.log(`Server started on ${PORT}`))
