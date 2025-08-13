const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

app.set('trust proxy', 1);

app.use(express.static(path.join(__dirname, 'public')));

const salas = {};
const MAX_USERS = 20;
const HISTORY_LIFETIME = 1440 * 60 * 1000;
const DISCONNECT_TIMEOUT = 5000;
const IDLE_TIMEOUT = 30 * 60 * 1000;

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

function sanitizeUsers(usersObject) {
    return Object.values(usersObject).map(u => ({
        id: u.id,
        nickname: u.nickname,
        idade: u.idade,
        status: u.status,
        color: u.color
    }));
}

function resetIdleTimer(socket) {
    const { sala, nickname } = socket;
    if (!sala || !nickname || !salas[sala]?.users[nickname]) return;

    const user = salas[sala].users[nickname];
    if (user.idleTimer) clearTimeout(user.idleTimer);

    user.idleTimer = setTimeout(() => {
        console.log(`[Inatividade] Expulsando ${nickname} da sala ${sala} por inatividade.`);
        io.to(user.id).emit('idleKick');
        socket.disconnect(true);
    }, IDLE_TIMEOUT);
}

io.on('connection', (socket) => {
  atualizarContagemSalas();

  socket.on('joinRoom', ({ sala, nickname, idade, color }) => {
    if (nickname.length > 20) {
        socket.emit('invalidData', { message: 'O nickname não pode ter mais de 20 caracteres.' });
        return;
    }

    if (!salas[sala]) {
      salas[sala] = { users: {}, history: [] };
    }
    const usersNaSala = salas[sala].users;

    const existingUser = Object.values(usersNaSala).find(u => u.nickname.toLowerCase() === nickname.toLowerCase());
    const isReconnecting = existingUser && existingUser.disconnectTimer;

    if (existingUser && !isReconnecting) {
        socket.emit('nicknameTaken', { nickname });
        return;
    }
    
    if (isReconnecting) {
      clearTimeout(existingUser.disconnectTimer);
      existingUser.disconnectTimer = null;
      existingUser.id = socket.id;
      socket.nickname = existingUser.nickname;
      socket.sala = sala;
      socket.join(sala);
      
      socket.emit('chatHistory', salas[sala].history);
      io.to(sala).emit('userList', sanitizeUsers(usersNaSala));
      resetIdleTimer(socket);

    } else {
      if (Object.keys(usersNaSala).length >= MAX_USERS) {
        socket.emit('roomFull');
        return;
      }
      socket.join(sala);
      socket.nickname = nickname;
      socket.sala = sala;
      
      usersNaSala[nickname] = { id: socket.id, nickname, idade, color, status: 'online', disconnectTimer: null, idleTimer: null };
      
      const now = Date.now();
      salas[sala].history = salas[sala].history.filter(msg => now - msg.timestamp <= HISTORY_LIFETIME);
      socket.emit('chatHistory', salas[sala].history);
      
      io.to(sala).emit('userList', sanitizeUsers(usersNaSala));
      io.to(sala).emit('message', { nickname: 'System', text: `${nickname} entrou na sala.`, mentions: [] });
      
      atualizarContagemSalas();
      resetIdleTimer(socket);
    }
  });

  socket.on('message', ({ text, mentions, imageData }) => {
    const { sala, nickname } = socket;
    if (sala && nickname && salas[sala]?.users[nickname]) {
      resetIdleTimer(socket);

      if (imageData && imageData.length > 1.5 * 1024 * 1024) {
          console.log(`[Segurança] ${nickname} tentou enviar uma imagem muito grande.`);
          return;
      }

      const user = salas[sala].users[nickname];
      const msg = { 
        nickname: user.nickname, 
        text, 
        mentions: mentions || [],
        timestamp: Date.now(),
        color: user.color,
        imageData: imageData
      };
      
      salas[sala].history.push(msg);
      io.to(sala).emit('message', msg);
    }
  });

  socket.on('updateStatus', (newStatus) => {
    const { sala, nickname } = socket;
    if (sala && nickname && salas[sala]?.users[nickname]) {
      salas[sala].users[nickname].status = newStatus;
      io.to(sala).emit('userList', sanitizeUsers(salas[sala].users));
      resetIdleTimer(socket);
    }
  });

  socket.on('disconnect', () => {
    const { sala, nickname } = socket;
    if (!sala || !nickname || !salas[sala]?.users[nickname]) return;

    const user = salas[sala].users[nickname];
    if (user.idleTimer) clearTimeout(user.idleTimer);
    
    const timer = setTimeout(() => {
      if (salas[sala]?.users[nickname]?.disconnectTimer === timer) {
        delete salas[sala].users[nickname];
        io.to(sala).emit('userList', sanitizeUsers(salas[sala].users));
        io.to(sala).emit('message', { nickname: 'System', text: `${nickname} saiu da sala.`, mentions: [] });
        atualizarContagemSalas();
      }
    }, DISCONNECT_TIMEOUT);

    salas[sala].users[nickname].disconnectTimer = timer;
  });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});