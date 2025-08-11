const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));

const salas = {};
const MAX_USERS = 20;
const HISTORY_LIFETIME = 60 * 60 * 1000; // 1h em ms

function atualizarContagemSalas() {
  const counts = {};
  for (const sala in salas) {
    counts[sala] = Object.keys(salas[sala].users).length;
  }
  console.log('Emitindo roomCounts:', counts);  // << debug
  io.emit('roomCounts', counts);
}
io.on('connection', (socket) => {
  // Envia a contagem atual para esse cliente logo que conectar
  const counts = {};
  for (const sala in salas) {
    counts[sala] = Object.keys(salas[sala].users).length;
  }
  socket.emit('roomCounts', counts);

  socket.on('joinRoom', ({ sala, nickname, idade }) => {
    if (!salas[sala]) {
      salas[sala] = { users: {}, history: [] };
    }
    if (Object.keys(salas[sala].users).length >= MAX_USERS) {
      socket.emit('roomFull');
      return;
    }
    socket.join(sala);
    salas[sala].users[socket.id] = { nickname, idade, status: 'online' };
    socket.sala = sala;

    // Envia histórico
    const now = Date.now();
    salas[sala].history = salas[sala].history.filter(msg => now - msg.timestamp <= HISTORY_LIFETIME);
    socket.emit('chatHistory', salas[sala].history);

    atualizarContagemSalas();

    io.to(sala).emit('userList', Object.values(salas[sala].users));
    io.to(sala).emit('message', { nickname: 'System', text: `${nickname} has joined the room.` });

    // Eventos do socket
    socket.on('message', (text) => {
      const msg = { nickname, text, timestamp: Date.now() };
      salas[sala].history.push(msg);
      io.to(sala).emit('message', msg);
    });

    socket.on('updateStatus', (newStatus) => {
      if (salas[sala] && salas[sala].users[socket.id]) {
        salas[sala].users[socket.id].status = newStatus;
        io.to(sala).emit('userList', Object.values(salas[sala].users));
      }
    });

    socket.on('disconnect', () => {
      if (salas[sala]) {
        const user = salas[sala].users[socket.id];
        if (user) {
          delete salas[sala].users[socket.id];
          atualizarContagemSalas();
          io.to(sala).emit('userList', Object.values(salas[sala].users));
          io.to(sala).emit('message', { nickname: 'System', text: `${user.nickname} has left the room.` });
        }
      }
    });
  });
});


const PORT = process.env.PORT || 3000;

http.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
