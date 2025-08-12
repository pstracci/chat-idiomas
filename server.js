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
    if (salas[sala] && salas[sala].users) {
      counts[sala] = Object.keys(salas[sala].users).length;
    } else {
      counts[sala] = 0;
    }
  }
  io.emit('roomCounts', counts);
}

io.on('connection', (socket) => {
  atualizarContagemSalas();

  socket.on('joinRoom', ({ sala, nickname, idade }) => {
    // --- NOVO: LÓGICA PARA VERIFICAR NICKNAME DUPLICADO ---
    if (salas[sala]) {
      const nicknameEmUso = Object.values(salas[sala].users).some(
        (user) => user.nickname.toLowerCase() === nickname.toLowerCase()
      );

      if (nicknameEmUso) {
        // Se o nickname já existe, emite um erro para o cliente e interrompe a função
        socket.emit('nicknameTaken', { nickname });
        return;
      }
    }
    // --- FIM DA VERIFICAÇÃO ---
    
    if (!salas[sala]) {
      salas[sala] = { users: {}, history: [] };
    }

    if (Object.keys(salas[sala].users).length >= MAX_USERS) {
      socket.emit('roomFull');
      return;
    }
    
    socket.join(sala);
    salas[sala].users[socket.id] = { id: socket.id, nickname, idade, status: 'online' };
    socket.sala = sala;

    const now = Date.now();
    salas[sala].history = salas[sala].history.filter(msg => now - msg.timestamp <= HISTORY_LIFETIME);
    socket.emit('chatHistory', salas[sala].history);

    io.to(sala).emit('userList', Object.values(salas[sala].users));
    io.to(sala).emit('message', { nickname: 'System', text: `${nickname} entrou na sala.`, mentions: [] });
    
    atualizarContagemSalas();
  });

  socket.on('message', ({ text, mentions }) => {
    const sala = socket.sala;
    if (sala && salas[sala] && salas[sala].users[socket.id]) {
      const user = salas[sala].users[socket.id];
      const msg = { 
        nickname: user.nickname, 
        text, 
        mentions: mentions || [],
        timestamp: Date.now() 
      };
      
      salas[sala].history.push(msg);
      io.to(sala).emit('message', msg);
    }
  });

  socket.on('updateStatus', (newStatus) => {
    const sala = socket.sala;
    if (sala && salas[sala] && salas[sala].users[socket.id]) {
      salas[sala].users[socket.id].status = newStatus;
      io.to(sala).emit('userList', Object.values(salas[sala].users));
    }
  });

  socket.on('disconnect', () => {
    const sala = socket.sala;
    if (sala && salas[sala] && salas[sala].users[socket.id]) {
      const user = salas[sala].users[socket.id];
      
      delete salas[sala].users[socket.id];
      
      io.to(sala).emit('userList', Object.values(salas[sala].users));
      if (user) {
        io.to(sala).emit('message', { nickname: 'System', text: `${user.nickname} saiu da sala.`, mentions: [] });
      }
      
      atualizarContagemSalas();
    }
  });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});