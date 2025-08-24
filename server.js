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
const authRoutes = require('./routes/auth');
const profileRoutes = require('./routes/profile');
const agoraRoutes = require('./routes/agora'); 
const videoRoutes = require('./routes/video');
const connectionsRoutes = require('./routes/connections');
const adminRoutes = require('./routes/admin');
const notificationRoutes = require('./routes/notifications');

app.get('/api/user/status', async (req, res) => {
    if (req.isAuthenticated()) {
        try {
            const userId = req.user.id;
            const [userWithProfile, connections] = await Promise.all([
                prisma.user.findUnique({ where: { id: userId }, include: { profile: true } }),
                prisma.connection.findMany({ 
                    where: { status: 'ACCEPTED', OR: [{ requesterId: userId }, { addresseeId: userId }] }, 
                    include: { 
                        requester: { select: { id: true, nickname: true, profile: { select: { profilePicture: true } } } }, 
                        addressee: { select: { id: true, nickname: true, profile: { select: { profilePicture: true } } } } 
                    } 
                }),
            ]);
            
            const friends = connections.map(conn => {
                const friend = conn.requesterId === userId ? conn.addressee : conn.requester;
                return { 
                    connectionId: conn.id, 
                    friendInfo: { 
                        id: friend.id, 
                        nickname: friend.nickname, 
                        profilePicture: friend.profile?.profilePicture,
                        isOnline: userSocketMap.hasOwnProperty(friend.id) 
                    } 
                };
            });

            res.json({ 
                loggedIn: true, 
                user: { id: userWithProfile.id, nickname: userWithProfile.nickname, role: req.user.role, profile: userWithProfile.profile }, 
                connections: friends 
            });
        } catch (error) {
            console.error("Erro ao buscar status completo do usuário:", error);
            res.status(500).json({ loggedIn: false, error: 'Erro interno do servidor' });
        }
    } else {
        res.json({ loggedIn: false });
    }
});

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
app.get('/stop-game.html', isAuthenticated, (req, res) => { res.sendFile(path.join(__dirname, 'public', 'stop-game.html')); });
app.get('/profile.html', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'profile.html')); });
app.get('/admin.html', isAuthenticated, (req, res) => { res.sendFile(path.join(__dirname, 'public', 'admin.html')); });

// --- LÓGICA DO SOCKET.IO ---
const userSocketMap = {}; 
const videoCallState = {};
const chatRooms = {}; // Objeto para gerenciar as salas de chat de idiomas

const wrap = middleware => (socket, next) => middleware(socket.request, {}, next);
io.use(wrap(sessionMiddleware));
io.use(wrap(passport.initialize()));
io.use(wrap(passport.session()));

io.on('connection', (socket) => {
    // Lógica de login e status online (já existente)
    if (socket.request.user) {
        const userId = socket.request.user.id;
        userSocketMap[userId] = socket.id;
        console.log(`[Socket.IO] Usuário ${userId} online com socket ${socket.id}`);
        socket.broadcast.emit('user_status_change', { userId, isOnline: true });
    }

    // =======================================================
    // === LÓGICA DO CHAT DE IDIOMAS (REINTEGRADA) ===
    // =======================================================
    socket.on('joinRoom', (data) => {
        const { sala, nickname, idade, color } = data;

        if (!nickname || nickname.length > 20 || !idade || idade < 18) {
            return socket.emit('invalidData', { message: 'Dados inválidos.' });
        }

        if (!chatRooms[sala]) {
            chatRooms[sala] = { users: {}, history: [] };
        }

        if (Object.keys(chatRooms[sala].users).length >= 20) {
            return socket.emit('roomFull');
        }

        if (Object.values(chatRooms[sala].users).some(u => u.nickname === nickname)) {
            return socket.emit('nicknameTaken', { nickname });
        }
        
        socket.join(sala);
        socket.room = sala;
        socket.nickname = nickname;

        chatRooms[sala].users[socket.id] = { nickname, idade, color, status: 'online' };

        socket.emit('chatHistory', chatRooms[sala].history);
        io.to(sala).emit('userList', Object.values(chatRooms[sala].users));
    });

    socket.on('message', (msg) => {
        if (!socket.room || !socket.nickname) return;
        
        const room = chatRooms[socket.room];
        const user = room.users[socket.id];

        if (room && user) {
            const messageData = {
                nickname: socket.nickname,
                color: user.color,
                text: msg.text,
                mentions: msg.mentions,
                imageData: msg.imageData
            };
            room.history.push(messageData);
            if (room.history.length > 100) {
                room.history.shift();
            }
            io.to(socket.room).emit('message', messageData);
        }
    });

    socket.on('updateStatus', (newStatus) => {
        if (socket.room && chatRooms[socket.room] && chatRooms[socket.room].users[socket.id]) {
            chatRooms[socket.room].users[socket.id].status = newStatus;
            io.to(socket.room).emit('userList', Object.values(chatRooms[socket.room].users));
        }
    });

    // =======================================================
    // === LÓGICA DE CHAMADA DE VÍDEO (JÁ EXISTENTE) ===
    // =======================================================
    socket.on('video:invite', async (data) => {
        const { recipientId } = data;
        const requester = socket.request.user;

        if (!requester) {
            console.error("[ERRO] Solicitante não autenticado na chamada de vídeo.");
            return;
        }
        
        try {
			const user = await prisma.user.findUnique({
                where: { id: requester.id },
                include: { profile: true }
            });

            if (!user || user.credits < 1) {
                return socket.emit('video:error', { message: 'Você não tem créditos suficientes para iniciar uma chamada.' });
            }

            await prisma.user.update({
                where: { id: requester.id },
                data: { credits: { decrement: 1 } }
            });
            
            const recipientSocketId = userSocketMap[recipientId];
            if (recipientSocketId) {
                const channel = randomUUID();
                io.to(recipientSocketId).emit('video:incoming_invite', {
                    requester: { id: requester.id, nickname: requester.nickname, profilePicture: user.profile?.profilePicture },
                    channel: channel
                });
                socket.emit('video:invite_sent', { 
                    channel: channel,
                    recipientId: recipientId
                });
            } else {
                await prisma.user.update({
                    where: { id: requester.id },
                    data: { credits: { increment: 1 } }
                });
                socket.emit('video:recipient_offline', { message: 'Este usuário não está online. Seu crédito foi devolvido.' });
            }
        } catch (error) {
            console.error("Erro ao processar convite de vídeo:", error);
            await prisma.user.update({
                where: { id: requester.id },
                data: { credits: { increment: 1 } }
            }).catch(refundError => console.error("Erro ao devolver crédito:", refundError));
            socket.emit('video:error', { message: 'Ocorreu um erro interno. Seu crédito foi devolvido.' });
        }
    });

    socket.on('video:accept', (data) => {
        const { requesterId, channel } = data;
        const recipient = socket.request.user;
        if (!recipient) return;

        const requesterSocketId = userSocketMap[requesterId];
        if (requesterSocketId) {
            const allParticipants = [requesterId, recipient.id];
            
            io.to(requesterSocketId).emit('video:invite_accepted', { channel });
            socket.emit('video:invite_accepted', { channel });

            const warningTimer = setTimeout(() => {
                allParticipants.forEach(id => {
                    const sockId = userSocketMap[id];
                    if (sockId) io.to(sockId).emit('video:warning_10_minutes', { channel });
                });
            }, 110 * 60 * 1000);

            const endTimer = setTimeout(() => {
                const room = videoCallState[channel];
                if (room) {
                    room.originalParticipants.forEach(participantId => {
                        const participantSocketId = userSocketMap[participantId];
                        if (participantSocketId) {
                            io.to(participantSocketId).emit('video:force_disconnect', { channel });
                        }
                    });
                    delete videoCallState[channel];
                }
            }, 120 * 60 * 1000);

            videoCallState[channel] = {
                participants: new Set(allParticipants),
                originalParticipants: new Set(allParticipants),
                warningTimer: warningTimer,
                endTimer: endTimer
            };
            
             allParticipants.forEach(id => {
                const sockId = userSocketMap[id];
                if (sockId) io.to(sockId).emit('video:call_started', { channel, participants: allParticipants });
            });
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
    
    // =======================================================
    // === LÓGICA DE DESCONEXÃO (UNIFICADA) ===
    // =======================================================
    socket.on('disconnect', () => {
        // Lógica de desconexão para o chat de idiomas
        if (socket.room && chatRooms[socket.room] && chatRooms[socket.room].users[socket.id]) {
            delete chatRooms[socket.room].users[socket.id];
            io.to(socket.room).emit('userList', Object.values(chatRooms[socket.room].users));
        }

        // Lógica de desconexão para status online e chamadas de vídeo
        const userId = socket.request.user?.id;
        if (userId) {
            if(userSocketMap[userId] === socket.id) {
                delete userSocketMap[userId];
                console.log(`[Socket.IO] Usuário ${userId} desconectado.`);
                io.emit('user_status_change', { userId, isOnline: false });
            } else {
                console.log(`[Socket.IO] Um socket antigo do usuário ${userId} foi desconectado.`);
            }

            for (const channel in videoCallState) {
                const room = videoCallState[channel];
                if (room.participants.has(userId)) {
                    room.participants.delete(userId);
                    console.log(`[Vídeo Sala] Usuário ${userId} saiu da sala ${channel}. Participantes restantes: ${room.participants.size}`);
                    socket.emit('video:call_ended', { channel });

                    if (room.participants.size === 1) {
                        const remainingUserId = [...room.participants][0];
                        const remainingUserSocketId = userSocketMap[remainingUserId];
                        if (remainingUserSocketId) {
                            console.log(`[Vídeo Sala] Notificando ${remainingUserId} que a chamada ${channel} terminou.`);
                            io.to(remainingUserSocketId).emit('video:call_ended', { channel });
                        }
                    }

                    if (room.participants.size === 0) {
                        console.log(`[Vídeo Sala] Sala ${channel} ficou vazia e foi destruída.`);
                        clearTimeout(room.warningTimer);
                        clearTimeout(room.endTimer);
                        delete videoCallState[channel];
                    }
                }
            }
        }
    });
});

// =======================================================
// === LÓGICA DO JOGO STOP! (NAMESPACE /stop) ===
// =======================================================
const stopRooms = {}; 
const stopNamespace = io.of('/stop');

stopNamespace.use(wrap(sessionMiddleware));
stopNamespace.use(wrap(passport.initialize()));
stopNamespace.use(wrap(passport.session()));

function getLobbyRooms() {
    return Object.values(stopRooms).map(room => ({
        id: room.id,
        name: room.name,
        participants: room.participants.size,
        maxParticipants: room.maxParticipants,
        isPrivate: room.isPrivate,
        status: room.status
    }));
}

stopNamespace.on('connection', (socket) => {
    socket.emit('updateRoomList', getLobbyRooms());

    socket.on('createRoom', (data) => {
        if (!socket.request.user) {
            return socket.emit('error', 'Você precisa estar logado para criar uma sala.');
        }
        const roomId = randomUUID();
        const ownerId = socket.request.user.id;

        stopRooms[roomId] = {
            id: roomId,
            name: data.name,
            ownerId: ownerId,
            ownerNickname: socket.request.user.nickname,
            participants: new Set(),
            maxParticipants: data.maxParticipants,
            isPrivate: data.isPrivate,
            password: data.password,
            categories: data.categories,
            status: 'Aguardando',
        };

        stopNamespace.emit('updateRoomList', getLobbyRooms());
        socket.emit('joinSuccess', roomId);
    });
    
    socket.on('joinRoom', (data) => {
        const room = stopRooms[data.roomId];
        if (!room) {
            return socket.emit('error', 'A sala não existe.');
        }
        if (room.participants.size >= room.maxParticipants) {
            return socket.emit('error', 'A sala está cheia.');
        }
        if (room.isPrivate && room.password !== data.password) {
            return socket.emit('error', 'Senha incorreta.');
        }
        socket.emit('joinSuccess', data.roomId);
    });
});

// --- INICIALIZAÇÃO DO SERVIDOR ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});