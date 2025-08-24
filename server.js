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
const { PrismaClient, Role } = require('@prisma/client');
const cors = require('cors');
const { randomUUID } = require('crypto');


// --- INICIALIZAÇÃO E CONFIGURAÇÃO ---
const prisma = new PrismaClient();
const app = express();
const corsOptions = {
    origin: 'https://www.verbi.com.br', 
    optionsSuccessStatus: 200
};
const server = http.createServer(app);
const io = new Server(server, {
    maxHttpBufferSize: 5e6 // 5MB
});

// --- MIDDLEWARES DO EXPRESS ---
app.use(cors(corsOptions));
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
            prisma.user.update({
                where: { id: req.user.id },
                data: { isOnline: true, lastSeen: new Date() },
            }).catch(err => console.error("Falha ao atualizar status do usuário:", err));
        } catch (error) {
            // Ignora erros
        }
    }
    next();
};
app.use(updateUserStatus);


// --- ROTAS ---
const authRoutes = require('./routes/auth');
const profileRoutes = require('./routes/profile');
const agoraRoutes = require('./routes/agora'); 
const videoRoutes = require('./routes/video');
const connectionsRoutes = require('./routes/connections');
const adminRoutes = require('./routes/admin');
const notificationRoutes = require('./routes/notifications');

app.use('/', authRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/agora', agoraRoutes);
app.use('/api/video', videoRoutes);
app.use('/api/connections', connectionsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/notifications', notificationRoutes);


function isAdmin(req, res, next) {
    if (req.user && req.user.role === Role.ADMIN) {
        return next();
    }
    return res.redirect('/'); 
}

function isAuthenticated(req, res, next) {
    if (req.isAuthenticated()) {
        return next();
    }
    res.redirect('/login.html');
}

app.get('/chat.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'chat.html'));
});

app.get('/stop-lobby.html', isAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'stop-lobby.html'));
});

app.get('/profile.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'profile.html'));
});

app.get('/admin.html', isAuthenticated, isAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});


// --- LÓGICA DO SOCKET.IO ---

const chatRooms = {};
const userSocketMap = {}; // Armazena { userId: socketId }

// Função 'wrapper' para usar middlewares do Express no Socket.IO
const wrap = middleware => (socket, next) => middleware(socket.request, {}, next);

// ****** INÍCIO DA CORREÇÃO ******
// Aplicando o middleware de sessão ao namespace PRINCIPAL do Socket.IO
io.use(wrap(sessionMiddleware));
io.use(wrap(passport.initialize()));
io.use(wrap(passport.session()));
// ****** FIM DA CORREÇÃO ******

// Namespace Principal (Chat de Idiomas e Notificações)
io.on('connection', (socket) => {
    console.log(`[Socket.IO] Nova conexão: ${socket.id}`);

    // Mapeia o usuário logado ao seu socket.id
    if (socket.request.user) {
        const userId = socket.request.user.id;
        userSocketMap[userId] = socket.id;
        console.log(`[Socket.IO] Usuário ${userId} (nickname: ${socket.request.user.nickname}) mapeado para o socket ${socket.id}`);
    }

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
            io.to(socket.sala).emit('userList', Object.values(chatRooms[sala].users));
        }
    });
    
    // --- LÓGICA DE CONVITE DE VÍDEO ---
   socket.on('video:invite', (data) => {
    const { recipientId } = data;
    const requester = socket.request.user;

    if (!requester) return;

    console.log(`[Vídeo Convite] ${requester.nickname} convida usuário ID: ${recipientId}`);
    const recipientSocketId = userSocketMap[recipientId];

    if (recipientSocketId) {
        const channel = randomUUID(); // Gera um canal único e válido
        
        // 1. Envia o convite para o destinatário (Participante B)
        io.to(recipientSocketId).emit('video:incoming_invite', {
            requester: {
                id: requester.id,
                nickname: requester.nickname,
                profilePicture: requester.profile?.profilePicture
            },
            channel: channel
        });

        // 2. Avisa o requisitante (Participante A) que o convite foi enviado e qual é o canal
        socket.emit('video:invite_sent', { 
            channel: channel,
            recipientId: recipientId
        });

    } else {
        socket.emit('video:recipient_offline', { message: 'Este usuário não está online.' });
    }
});

    socket.on('video:accept', (data) => {
        const { requesterId, channel } = data;
        const requesterSocketId = userSocketMap[requesterId];
        console.log(`[Vídeo Convite] Convite aceito pelo destinatário. Notificando o requisitante (ID: ${requesterId})`);

        if (requesterSocketId) {
            io.to(requesterSocketId).emit('video:invite_accepted', { channel });
        }
    });

    socket.on('video:decline', (data) => {
        const { requesterId } = data;
        const recipientNickname = socket.request.user.nickname;
        const requesterSocketId = userSocketMap[requesterId];
        console.log(`[Vídeo Convite] Convite recusado pelo destinatário. Notificando o requisitante (ID: ${requesterId})`);

        if (requesterSocketId) {
            io.to(requesterSocketId).emit('video:invite_declined', { 
                message: `${recipientNickname} recusou a chamada.` 
            });
        }
    });


    socket.on('disconnect', () => {
        if (socket.request.user) {
            const userId = socket.request.user.id;
            if (userSocketMap[userId] === socket.id) {
                delete userSocketMap[userId];
                console.log(`[Socket.IO] Usuário ${userId} (nickname: ${socket.request.user.nickname}) desconectado e removido do mapa.`);
            }
        }
        clearTimeout(idleTimeout);
        if (socket.sala && chatRooms[socket.sala] && chatRooms[socket.sala].users[socket.id]) {
            delete chatRooms[socket.sala].users[socket.id];
            io.to(socket.sala).emit('userList', Object.values(chatRooms[socket.sala].users));
            io.emit('roomCounts', Object.keys(chatRooms).reduce((acc, key) => { acc[key] = Object.keys(chatRooms[key].users).length; return acc; }, {}));
        }
        console.log(`[Socket.IO] Conexão ${socket.id} encerrada.`);
    });
});

// Namespace do Jogo STOP!
const stopGameNamespace = io.of('/stop');
stopGameNamespace.use(wrap(sessionMiddleware));
stopGameNamespace.use(wrap(passport.initialize()));
stopGameNamespace.use(wrap(passport.session()));
const { handleStopGameConnection } = require('./sockets/stopGameSocket');
handleStopGameConnection(stopGameNamespace, prisma, io);


// --- INICIALIZAÇÃO DO SERVIDOR ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});