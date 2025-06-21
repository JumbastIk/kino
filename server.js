// server.js
require('dotenv').config()

const http    = require('http')
const express = require('express')
const { Server } = require('socket.io')
const cors    = require('cors')
const path    = require('path')
const fs      = require('fs')

// Используем ваш модуль с уже настроенным клиентом Supabase
const supabase = require('./supabase')

const app = express()
app.use(cors())
app.use(express.json())
app.use(express.static(__dirname))

// === REST API: получить список комнат ===
app.get('/api/rooms', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('rooms')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) throw error
    res.json(data)
  } catch (err) {
    console.error('[GET /api/rooms] Error:', err)
    res.status(500).json({ error: 'DB error', details: err.message })
  }
})

// === REST API: создать новую комнату ===
app.post('/api/rooms', async (req, res) => {
  try {
    const { title, movieId } = req.body
    const id = Math.random().toString(36).substr(2, 9)

    const { error: insertError } = await supabase
      .from('rooms')
      .insert([{
        id,
        title: title || 'Без названия',
        movie_id: movieId || null,
        viewers: 1,
        created_at: new Date().toISOString()
      }])

    if (insertError) throw insertError

    const { data: newRoom, error: selectError } = await supabase
      .from('rooms')
      .select('*')
      .eq('id', id)
      .single()

    if (selectError) throw selectError

    // Оповещаем всех через Socket.io о новой комнате
    io.emit('room_created', newRoom)

    res.json({ id })
  } catch (err) {
    console.error('[POST /api/rooms] Error:', err)
    res.status(500).json({ error: 'DB error', details: err.message })
  }
})

// === SPA‐fallback для всех прочих GET-запросов ===
app.get(/^\/(?!api|socket\.io).*/, (req, res) => {
  const index = path.join(__dirname, 'index.html')
  if (fs.existsSync(index)) return res.sendFile(index)
  res.status(404).send('index.html not found')
})

// === HTTP + Socket.io сервер ===
const server = http.createServer(app)
const io     = new Server(server, { cors: { origin: '*' } })

// Словарь для состояния плеера в каждой комнате
const roomsState = {
  // roomId: { videoId, time, playing, speed, lastUpdate }
}

io.on('connection', socket => {
  let currentRoom = null

  socket.on('join', async ({ roomId, userData }) => {
    currentRoom = roomId
    socket.join(roomId)

    // Инкремент viewers через Supabase RPC
    try {
      const { error: incErr } = await supabase.rpc('increment_viewers', { room_id: roomId })
      if (incErr) throw incErr

      const { data: roomData, error: selErr } = await supabase
        .from('rooms')
        .select('viewers')
        .eq('id', roomId)
        .single()
      if (selErr) throw selErr

      io.to(roomId).emit('users', roomData.viewers)
    } catch (err) {
      console.error('[Socket join] viewers increment error:', err)
    }

    // Отправляем новому участнику текущее состояние плеера
    const state = roomsState[roomId] || {
      videoId: null,
      time: 0,
      playing: false,
      speed: 1,
      lastUpdate: Date.now()
    }
    socket.emit('syncState', state)
  })

  socket.on('play', ({ time, speed }) => {
    if (!currentRoom) return
    roomsState[currentRoom] = {
      ...roomsState[currentRoom],
      time,
      playing: true,
      speed: speed || 1,
      lastUpdate: Date.now()
    }
    socket.to(currentRoom).emit('play', { time, speed, timestamp: Date.now() })
  })

  socket.on('pause', ({ time }) => {
    if (!currentRoom) return
    roomsState[currentRoom] = {
      ...roomsState[currentRoom],
      time,
      playing: false,
      lastUpdate: Date.now()
    }
    socket.to(currentRoom).emit('pause', { time, timestamp: Date.now() })
  })

  socket.on('seek', ({ time }) => {
    if (!currentRoom) return
    roomsState[currentRoom] = {
      ...roomsState[currentRoom],
      time,
      lastUpdate: Date.now()
    }
    socket.to(currentRoom).emit('seek', { time, timestamp: Date.now() })
  })

  socket.on('changeVideo', ({ videoId }) => {
    if (!currentRoom) return
    roomsState[currentRoom] = {
      videoId,
      time: 0,
      playing: false,
      speed: 1,
      lastUpdate: Date.now()
    }
    io.to(currentRoom).emit('changeVideo', roomsState[currentRoom])
  })

  socket.on('disconnect', async () => {
    if (!currentRoom) return

    // Декремент viewers через Supabase RPC
    try {
      const { error: decErr } = await supabase.rpc('decrement_viewers', { room_id: currentRoom })
      if (decErr) throw decErr

      const { data: roomData, error: selErr } = await supabase
        .from('rooms')
        .select('viewers')
        .eq('id', currentRoom)
        .single()
      if (selErr) throw selErr

      io.to(currentRoom).emit('users', roomData.viewers)
    } catch (err) {
      console.error('[Socket disconnect] viewers decrement error:', err)
    }

    currentRoom = null
  })
})

const PORT = process.env.PORT || 3000
server.listen(PORT, () => console.log(`Server started on port ${PORT}`))
