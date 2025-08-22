// server.js
if (process.env.NODE_ENV !== "production") {
  require("dotenv").config();
}
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const PgSimple = require('connect-pg-simple')(session);
const { PrismaClient } = require('@prisma/client');


// --- INICIALIZAÇÃO E CONFIGURAÇÃO ---
const prisma = new PrismaClient();
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    maxHttpBufferSize: 5e6 // 5MB
});

// --- MIDDLEWARES DO EXPRESS ---
app.set('trust proxy', 1);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));


// --- AUTENTICAÇÃO E SESSÕES ---
const sessionMiddleware = session({
    store: new PgSimple({ prisma, tableName: 'session' }),
    secret: process.env.SESSION_SECRET || 'dev-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 }
});
app.use(sessionMiddleware);

require('./config/passport-setup');
app.use(passport.initialize());
app.use(passport.session());

// --- MIDDLEWARE PARA STATUS ONLINE ---
const updateUserStatus = async (req, res, next) => {
    if (req.isAuthenticated()) {
        try {
            // Executa a atualização em segundo plano sem bloquear a resposta do usuário
            prisma.user.update({
                where: { id: req.user.id },
                data: { isOnline: true, lastSeen: new Date() },
            }).catch(err => console.error("Falha ao atualizar status do usuário:", err));
        } catch (error) {
            // Ignora erros para não quebrar a aplicação
        }
    }
    next();
};
app.use(updateUserStatus);


// --- ROTAS ---
const authRoutes = require('./routes/auth');
const profileRoutes = require('./routes/profile');
const agoraRoutes = require('./routes/agora'); 
app.use('/', authRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/agora', agoraRoutes);


function isAuthenticated(req, res, next) {
    if (req.isAuthenticated()) return next();
    res.redirect('/login.html');
}

app.get('/api/user/status', (req, res) => {
    if (req.isAuthenticated()) {
        // Incluído o userId, necessário para o frontend do perfil
        res.json({ loggedIn: true, nickname: req.user.nickname, userId: req.user.id });
    } else {
        res.json({ loggedIn: false });
    }
});

app.get('/stop-lobby.html', isAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'stop-lobby.html'));
});

app.get('/profile.html', isAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'profile.html'));
});


// --- LÓGICA DO SOCKET.IO ---
const chatRooms = {};

// Namespace Principal (Chat de Idiomas)
io.on('connection', (socket) => {
    let idleTimeout;

    const resetIdleTimeout = () => {
        clearTimeout(idleTimeout);
        idleTimeout = setTimeout(() => {
            socket.emit('idleKick');
            socket.disconnect(true);
        }, 30 * 60 * 1000);
    };

    socket.on('joinRoom', (data) => {
        const { sala, nickname, idade, color } = data;
        if (!sala || !nickname || !idade) return socket.emit('invalidData', { message: 'Dados inválidos.' });
        if (idade < 18) return socket.emit('invalidData', { message: 'Você precisa ter 18 anos ou mais.' });
        if (!chatRooms[sala]) chatRooms[sala] = { users: {}, history: [] };
        if (Object.values(chatRooms[sala].users).find(u => u.nickname.toLowerCase() === nickname.toLowerCase())) return socket.emit('nicknameTaken', { nickname });
        if (Object.keys(chatRooms[sala].users).length >= 20) return socket.emit('roomFull');
        socket.join(sala);
        socket.sala = sala;
        socket.nickname = nickname;
        chatRooms[sala].users[socket.id] = { nickname, idade, color, status: 'online' };
        socket.emit('chatHistory', chatRooms[sala].history);
        io.to(sala).emit('userList', Object.values(chatRooms[sala].users));
        io.emit('roomCounts', Object.keys(chatRooms).reduce((acc, key) => { acc[key] = Object.keys(chatRooms[key].users).length; return acc; }, {}));
        resetIdleTimeout();
    });

    socket.on('message', (msg) => {
        if (socket.sala && socket.nickname) {
            const messageData = { nickname: socket.nickname, text: msg.text, color: chatRooms[socket.sala].users[socket.id]?.color, mentions: msg.mentions, imageData: msg.imageData };
            chatRooms[socket.sala].history.push(messageData);
            if (chatRooms[socket.sala].history.length > 100) chatRooms[socket.sala].history.shift();
            io.to(socket.sala).emit('message', messageData);
            resetIdleTimeout();
        }
    });

    socket.on('updateStatus', (newStatus) => {
        if (socket.sala && chatRooms[socket.sala].users[socket.id]) {
            chatRooms[socket.sala].users[socket.id].status = newStatus;
            io.to(socket.sala).emit('userList', Object.values(chatRooms[socket.sala].users));
        }
    });

    socket.on('disconnect', () => {
        clearTimeout(idleTimeout);
        if (socket.sala && chatRooms[socket.sala] && chatRooms[socket.sala].users[socket.id]) {
            delete chatRooms[socket.sala].users[socket.id];
            io.to(socket.sala).emit('userList', Object.values(chatRooms[socket.sala].users));
            io.emit('roomCounts', Object.keys(chatRooms).reduce((acc, key) => { acc[key] = Object.keys(chatRooms[key].users).length; return acc; }, {}));
        }
    });
});

// Namespace do Jogo STOP!
const stopGameNamespace = io.of('/stop');
const wrap = middleware => (socket, next) => middleware(socket.request, {}, next);
stopGameNamespace.use(wrap(sessionMiddleware));
stopGameNamespace.use(wrap(passport.initialize()));
stopGameNamespace.use(wrap(passport.session()));

// Importa e executa a lógica do jogo refatorada
const { handleStopGameConnection } = require('./sockets/stopGameSocket');
handleStopGameConnection(stopGameNamespace, prisma, io);


// --- INICIALIZAÇÃO DO SERVIDOR ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});