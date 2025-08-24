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
const cors = require('cors');
const { randomUUID } = require('crypto');

// --- INICIALIZAÇÃO E CONFIGURAÇÃO ---
const prisma = new PrismaClient();
const app = express();
const corsOptions = { origin: 'https://www.verbi.com.br', optionsSuccessStatus: 200 };
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 5e6 });

// ... (O restante dos seus middlewares e rotas do Express continua o mesmo)
app.use(cors(corsOptions));
app.set('trust proxy', 1);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({ store: new PgSimple({ prisma, tableName: 'session' }), secret: process.env.SESSION_SECRET || 'dev-secret', resave: false, saveUninitialized: false, cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 }}));
require('./config/passport-setup');
app.use(passport.initialize());
app.use(passport.session());
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
app.get('/profile.html', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'profile.html')); });
app.get('/admin.html', isAuthenticated, (req, res) => { res.sendFile(path.join(__dirname, 'public', 'admin.html')); });
// --- FIM DA SEÇÃO EXPRESS ---


// --- LÓGICA DO SOCKET.IO ---
const userSocketMap = {}; // { userId: socketId }
const videoCallState = {}; // { channel: { participants: Set<userId>, originalParticipants: Set<userId>, timeoutId: NodeJS.Timeout } }

const wrap = middleware => (socket, next) => middleware(socket.request, {}, next);
io.use(wrap(session({ store: new PgSimple({ prisma, tableName: 'session' }), secret: process.env.SESSION_SECRET || 'dev-secret', resave: false, saveUninitialized: false, cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 }})));
io.use(wrap(passport.initialize()));
io.use(wrap(passport.session()));

io.on('connection', (socket) => {
    if (socket.request.user) {
        const userId = socket.request.user.id;
        userSocketMap[userId] = socket.id;
    }

    socket.on('video:invite', async (data) => {
        const { recipientId } = data;
        const requester = socket.request.user;
        if (!requester) return;
        
        try {
            const user = await prisma.user.findUnique({ where: { id: requester.id } });
            if (!user || user.credits < 1) {
                return socket.emit('video:error', { message: 'Você não tem créditos suficientes.' });
            }
            await prisma.user.update({ where: { id: requester.id }, data: { credits: { decrement: 1 } } });
            
            const recipientSocketId = userSocketMap[recipientId];
            if (recipientSocketId) {
                const channel = randomUUID();
                io.to(recipientSocketId).emit('video:incoming_invite', {
                    requester: { id: requester.id, nickname: requester.nickname, profilePicture: user.profile?.profilePicture },
                    channel: channel
                });
                socket.emit('video:invite_sent', { channel: channel, recipientId: recipientId });
            } else {
                await prisma.user.update({ where: { id: requester.id }, data: { credits: { increment: 1 } } });
                socket.emit('video:recipient_offline', { message: 'Este usuário não está online. Seu crédito foi devolvido.' });
            }
        } catch (error) {
            console.error("Erro ao processar convite de vídeo:", error);
            await prisma.user.update({ where: { id: requester.id }, data: { credits: { increment: 1 } } }).catch(e => console.error("Erro ao devolver crédito:", e));
            socket.emit('video:error', { message: 'Ocorreu um erro. Seu crédito foi devolvido.' });
        }
    });

    socket.on('video:accept', (data) => {
        const { requesterId, channel } = data;
        const recipient = socket.request.user;
        if (!recipient) return;

        const requesterSocketId = userSocketMap[requesterId];
        if (requesterSocketId) {
            const allParticipants = [requesterId, recipient.id];
            
            // Notifica ambos que a chamada foi aceita para serem redirecionados
            io.to(requesterSocketId).emit('video:invite_accepted', { channel });
            socket.emit('video:invite_accepted', { channel }); // Notifica o próprio recipiente

            // Timer de 110 minutos para o aviso
            const warningTimer = setTimeout(() => {
                allParticipants.forEach(id => {
                    const sockId = userSocketMap[id];
                    if (sockId) io.to(sockId).emit('video:warning_10_minutes', { channel });
                });
            }, 110 * 60 * 1000);

            // Timer de 120 minutos para encerrar a chamada
            const endTimer = setTimeout(() => {
                allParticipants.forEach(id => {
                    const sockId = userSocketMap[id];
                    if (sockId) io.to(sockId).emit('video:force_disconnect', { channel });
                });
                delete videoCallState[channel];
            }, 120 * 60 * 1000);

            videoCallState[channel] = {
                participants: new Set(allParticipants),
                originalParticipants: new Set(allParticipants),
                warningTimer: warningTimer,
                endTimer: endTimer
            };

            // Notifica ambos para mudarem o ícone para "em andamento"
             allParticipants.forEach(id => {
                const sockId = userSocketMap[id];
                if (sockId) io.to(sockId).emit('video:call_started', { channel, participants: allParticipants });
            });
        }
    });

    socket.on('video:decline', (data) => {
        const { requesterId, channel } = data;
        const requesterSocketId = userSocketMap[requesterId];
        if (requesterSocketId) {
            io.to(requesterSocketId).emit('video:invite_declined', { 
                message: `${socket.request.user.nickname} recusou a chamada.`,
                channel: channel
            });
        }
    });

    socket.on('disconnect', () => {
        const userId = socket.request.user?.id;
        if (userId) {
            delete userSocketMap[userId];

            for (const channel in videoCallState) {
                const room = videoCallState[channel];
                if (room.participants.has(userId)) {
                    room.participants.delete(userId);

                    if (room.participants.size === 0) {
                        // Se a sala ficar vazia, destrói tudo e avisa os participantes originais para resetar a UI
                        console.log(`[Vídeo Sala] Sala ${channel} vazia. Destruindo.`);
                        clearTimeout(room.warningTimer);
                        clearTimeout(room.endTimer);
                        
                        room.originalParticipants.forEach(participantId => {
                            const socketId = userSocketMap[participantId];
                            if (socketId) io.to(socketId).emit('video:call_ended', { channel });
                        });
                        delete videoCallState[channel];
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