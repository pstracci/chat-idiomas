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
const corsOptions = { origin: 'https://www.verbi.com.br', optionsSuccessStatus: 200 };
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 5e6 });

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

// --- ROTAS E MIDDLEWARES DE AUTENTICAÇÃO ---
// (O código das rotas e middlewares de autenticação continua o mesmo...)
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
function isAuthenticated(req, res, next) { if (req.isAuthenticated()) { return next(); } res.redirect('/login.html'); }
app.get('/chat.html', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'chat.html')); });
app.get('/stop-lobby.html', isAuthenticated, (req, res) => { res.sendFile(path.join(__dirname, 'public', 'stop-lobby.html')); });
// ... (outras rotas GET continuam as mesmas)

// --- LÓGICA DO SOCKET.IO ---
const userSocketMap = {}; // { userId: socketId }
const videoCallState = {}; // { channel: { participants: Set<userId>, timeoutId: NodeJS.Timeout } }

const wrap = middleware => (socket, next) => middleware(socket.request, {}, next);
io.use(wrap(sessionMiddleware));
io.use(wrap(passport.initialize()));
io.use(wrap(passport.session()));

io.on('connection', (socket) => {
    if (socket.request.user) {
        const userId = socket.request.user.id;
        userSocketMap[userId] = socket.id;
        console.log(`[Socket.IO] Usuário ${userId} mapeado para o socket ${socket.id}`);
    }

    // --- LÓGICA DE CONVITE DE VÍDEO (ATUALIZADA) ---
    socket.on('video:invite', async (data) => {
        const { recipientId } = data;
        const requester = socket.request.user;
        if (!requester) return;

        // Lógica de dedução de crédito (exemplo)
        const userProfile = await prisma.profile.findUnique({ where: { userId: requester.id } });
        if (!userProfile || userProfile.credits < 1) {
            return socket.emit('video:error', { message: 'Você não tem créditos suficientes.' });
        }
        await prisma.profile.update({
            where: { userId: requester.id },
            data: { credits: { decrement: 1 } }
        });

        const recipientSocketId = userSocketMap[recipientId];
        if (recipientSocketId) {
            const channel = randomUUID();
            io.to(recipientSocketId).emit('video:incoming_invite', {
                requester: { id: requester.id, nickname: requester.nickname, profilePicture: requester.profile?.profilePicture },
                channel: channel
            });
            socket.emit('video:invite_sent', { channel: channel, recipientId: recipientId });
        } else {
            socket.emit('video:recipient_offline', { message: 'Este usuário não está online.' });
        }
    });

    socket.on('video:accept', (data) => {
        const { requesterId, channel } = data;
        const recipient = socket.request.user;
        if (!recipient) return;

        const requesterSocketId = userSocketMap[requesterId];
        if (requesterSocketId) {
            console.log(`[Vídeo Sala] Sala ${channel} criada entre ${requesterId} e ${recipient.id}`);
            
            // Inicia o timer de 120 minutos no servidor
            const timeoutId = setTimeout(() => {
                console.log(`[Vídeo Sala] Sala ${channel} expirou.`);
                const room = videoCallState[channel];
                if (room) {
                    room.participants.forEach(participantId => {
                        const participantSocketId = userSocketMap[participantId];
                        if (participantSocketId) {
                            io.to(participantSocketId).emit('video:force_disconnect', { channel });
                        }
                    });
                }
                delete videoCallState[channel];
            }, 120 * 60 * 1000);

            // Armazena o estado da sala
            videoCallState[channel] = {
                participants: new Set([requesterId, recipient.id]),
                timeoutId: timeoutId
            };
            
            io.to(requesterSocketId).emit('video:invite_accepted', { channel });
        }
    });

    socket.on('video:decline', (data) => {
        const { requesterId, channel } = data;
        const recipientNickname = socket.request.user.nickname;
        const requesterSocketId = userSocketMap[requesterId];
        if (requesterSocketId) {
            io.to(requesterSocketId).emit('video:invite_declined', { 
                message: `${recipientNickname} recusou a chamada.`,
                channel: channel
            });
        }
    });

    socket.on('disconnect', () => {
        const userId = socket.request.user?.id;
        if (userId) {
            delete userSocketMap[userId];
            console.log(`[Socket.IO] Usuário ${userId} desconectado.`);

            // Verifica se o usuário estava em uma chamada de vídeo
            for (const channel in videoCallState) {
                const room = videoCallState[channel];
                if (room.participants.has(userId)) {
                    room.participants.delete(userId); // Remove o usuário da sala
                    console.log(`[Vídeo Sala] Usuário ${userId} saiu da sala ${channel}. Restantes: ${room.participants.size}`);

                    // Se a sala ficar vazia, destrói e notifica o outro participante
                    if (room.participants.size === 0) {
                        console.log(`[Vídeo Sala] Sala ${channel} ficou vazia e foi destruída.`);
                        clearTimeout(room.timeoutId); // Cancela o timer de 120 minutos
                        delete videoCallState[channel];

                        // Notifica ambos os usuários originais para resetar a UI
                        const originalParticipants = Array.from(new Set([room.initiator, ...room.participants, userId]));
                        originalParticipants.forEach(participantId => {
                            const socketId = userSocketMap[participantId];
                            if (socketId) {
                                io.to(socketId).emit('video:call_ended', { channel });
                            }
                        });
                    }
                }
            }
        }
    });
});


// --- INICIALIZAÇÃO DO SERVIDOR ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});