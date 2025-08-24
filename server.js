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
const chatRooms = {};

const wrap = middleware => (socket, next) => middleware(socket.request, {}, next);
io.use(wrap(sessionMiddleware));
io.use(wrap(passport.initialize()));
io.use(wrap(passport.session()));

io.on('connection', (socket) => {
    if (socket.request.user) {
        const userId = socket.request.user.id;
        userSocketMap[userId] = socket.id;
        console.log(`[Socket.IO] Usuário ${userId} online com socket ${socket.id}`);
        socket.broadcast.emit('user_status_change', { userId, isOnline: true });
    }

    // ===== CÓDIGO RESTAURADO: CHAT DE IDIOMAS =====
    socket.on('joinRoom', (data) => {
        const { sala, nickname, idade, color } = data;
        if (!nickname || nickname.length > 20 || !idade || idade < 18) return socket.emit('invalidData', { message: 'Dados inválidos.' });
        if (!chatRooms[sala]) chatRooms[sala] = { users: {}, history: [] };
        if (Object.keys(chatRooms[sala].users).length >= 20) return socket.emit('roomFull');
        if (Object.values(chatRooms[sala].users).some(u => u.nickname === nickname)) return socket.emit('nicknameTaken', { nickname });
        
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
            const messageData = { nickname: socket.nickname, color: user.color, text: msg.text, mentions: msg.mentions, imageData: msg.imageData };
            room.history.push(messageData);
            if (room.history.length > 100) room.history.shift();
            io.to(socket.room).emit('message', messageData);
        }
    });

    socket.on('updateStatus', (newStatus) => {
        if (socket.room && chatRooms[socket.room] && chatRooms[socket.room].users[socket.id]) {
            chatRooms[socket.room].users[socket.id].status = newStatus;
            io.to(socket.room).emit('userList', Object.values(chatRooms[socket.room].users));
        }
    });
    // ===== FIM DO CÓDIGO RESTAURADO =====

    // ===== CÓDIGO RESTAURADO: CHAMADA DE VÍDEO =====
    socket.on('video:invite', async (data) => {
        const { recipientId } = data;
        const requester = socket.request.user;
        if (!requester) return console.error("[ERRO] Solicitante não autenticado na chamada de vídeo.");
        
        try {
			const user = await prisma.user.findUnique({ where: { id: requester.id }, include: { profile: true } });
            if (!user || user.credits < 1) return socket.emit('video:error', { message: 'Você não tem créditos suficientes para iniciar uma chamada.' });

            await prisma.user.update({ where: { id: requester.id }, data: { credits: { decrement: 1 } } });
            
            const recipientSocketId = userSocketMap[recipientId];
            if (recipientSocketId) {
                const channel = randomUUID();
                io.to(recipientSocketId).emit('video:incoming_invite', { requester: { id: requester.id, nickname: requester.nickname, profilePicture: user.profile?.profilePicture }, channel: channel });
                socket.emit('video:invite_sent', { channel: channel, recipientId: recipientId });
            } else {
                await prisma.user.update({ where: { id: requester.id }, data: { credits: { increment: 1 } } });
                socket.emit('video:recipient_offline', { message: 'Este usuário não está online. Seu crédito foi devolvido.' });
            }
        } catch (error) {
            console.error("Erro ao processar convite de vídeo:", error);
            await prisma.user.update({ where: { id: requester.id }, data: { credits: { increment: 1 } } }).catch(e => console.error("Erro ao devolver crédito:", e));
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
            
            const warningTimer = setTimeout(() => allParticipants.forEach(id => { const s = userSocketMap[id]; if (s) io.to(s).emit('video:warning_10_minutes', { channel }); }), 110 * 60 * 1000);
            const endTimer = setTimeout(() => {
                const room = videoCallState[channel];
                if (room) {
                    room.originalParticipants.forEach(id => { const s = userSocketMap[id]; if (s) io.to(s).emit('video:force_disconnect', { channel }); });
                    delete videoCallState[channel];
                }
            }, 120 * 60 * 1000);

            videoCallState[channel] = { participants: new Set(allParticipants), originalParticipants: new Set(allParticipants), warningTimer, endTimer };
            allParticipants.forEach(id => { const s = userSocketMap[id]; if (s) io.to(s).emit('video:call_started', { channel, participants: allParticipants }); });
        }
    });

    socket.on('video:decline', (data) => {
        const { requesterId, channel } = data;
        const recipientNickname = socket.request.user.nickname;
        const requesterSocketId = userSocketMap[requesterId];
        if (requesterSocketId) {
            io.to(requesterSocketId).emit('video:invite_declined', { message: `${recipientNickname} recusou a chamada.`, channel: channel });
        }
    });
    // ===== FIM DO CÓDIGO RESTAURADO =====
    
    // ===== LÓGICA DE DESCONEXÃO UNIFICADA (RESTAURADA E COMPLETA) =====
socket.on('disconnect', () => {
    // Primeiro, lida com a saída de salas de chat anônimas
    if (socket.room && chatRooms[socket.room] && chatRooms[socket.room].users[socket.id]) {
        delete chatRooms[socket.room].users[socket.id];
        io.to(socket.room).emit('userList', Object.values(chatRooms[socket.room].users));
    }

    const userId = socket.request.user?.id;
    if (userId) {
        // Apenas processa a desconexão se o socket que está se desconectando
        // for o último socket conhecido para este usuário.
        if(userSocketMap[userId] === socket.id) {
            // Adiciona um atraso para lidar com a navegação entre páginas
            setTimeout(() => {
                // Após o atraso, verifica novamente. Se o usuário reconectou em outra página,
                // o socket.id em userSocketMap será diferente, e não faremos nada.
                if (userSocketMap[userId] === socket.id) {
                    delete userSocketMap[userId];
                    console.log(`[Socket.IO] Usuário ${userId} desconectado.`);
                    io.emit('user_status_change', { userId, isOnline: false });
                }
            }, 1500); // Atraso de 1.5 segundos
        }

        // Lógica para chamadas de vídeo (permanece a mesma)
        for (const channel in videoCallState) {
            const room = videoCallState[channel];
            if (room.participants.has(userId)) {
                room.participants.delete(userId);
                socket.emit('video:call_ended', { channel });
                if (room.participants.size === 1) {
                    const remainingUserId = [...room.participants][0];
                    const remainingSocketId = userSocketMap[remainingUserId];
                    if (remainingSocketId) io.to(remainingSocketId).emit('video:call_ended', { channel });
                }
                if (room.participants.size === 0) {
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
// === LÓGICA DO JOGO STOP! (NAMESPACE /stop) - MANTIDA E FUNCIONAL ===
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
        participants: room.players.size,
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
            id: roomId, name: data.name, ownerId: ownerId, ownerNickname: socket.request.user.nickname,
            players: new Map(), maxParticipants: data.maxParticipants, totalRounds: 5, isPrivate: data.isPrivate,
            password: data.password, categories: data.categories, status: 'Aguardando',
            gameState: { currentRound: 0, currentLetter: '', answers: {}, roundScores: {}, roundTimer: null },
            chatHistory: []
        };
        stopNamespace.emit('updateRoomList', getLobbyRooms());
        socket.emit('joinSuccess', roomId);
    });
    
    socket.on('joinRoom', (data) => {
        const room = stopRooms[data.roomId];
        if (!room) return socket.emit('error', 'A sala não existe.');
        if (room.players.size >= room.maxParticipants) return socket.emit('error', 'A sala está cheia.');
        if (room.isPrivate && room.password !== data.password) return socket.emit('error', 'Senha incorreta.');
        socket.emit('joinSuccess', data.roomId);
    });

    socket.on('playerReady', (data) => {
        const user = socket.request.user;
        if (!user) return socket.emit('error', 'Usuário não autenticado.');

        const { roomId } = data;
        const room = stopRooms[roomId];
        if (!room) return socket.emit('error', 'A sala não existe mais.');
        
        const isSpectating = room.status === 'Jogando';
        if (room.players.size >= room.maxParticipants && !room.players.has(user.id)) {
             return socket.emit('error', 'A sala está cheia.');
        }

        socket.join(roomId);
        socket.roomId = roomId;

        if (!isSpectating && !room.players.has(user.id)) {
            const isOwner = user.id === room.ownerId;
            const player = { id: user.id, nickname: user.nickname, isOwner: isOwner, isReady: isOwner, score: 0, wins: 0 };
            room.players.set(user.id, player);
        }

        socket.emit('roomInfo', {
            name: room.name, isOwner: user.id === room.ownerId, categories: room.categories,
            maxParticipants: room.maxParticipants, totalRounds: room.totalRounds,
            isPrivate: room.isPrivate, ownerNickname: room.ownerNickname,
            currentRound: room.gameState.currentRound, isSpectating: isSpectating
        });
        
        socket.emit('stopChatHistory', room.chatHistory);
        const playerList = Array.from(room.players.values());
        stopNamespace.to(roomId).emit('updatePlayerList', playerList);
        stopNamespace.emit('updateRoomList', getLobbyRooms());
    });

    socket.on('toggleReady', () => {
        const user = socket.request.user;
        const roomId = socket.roomId;
        if (!user || !roomId || !stopRooms[roomId]) return;

        const room = stopRooms[roomId];
        const player = room.players.get(user.id);

        if (player && !player.isOwner) {
            player.isReady = !player.isReady;
            const playerList = Array.from(room.players.values());
            stopNamespace.to(roomId).emit('updatePlayerList', playerList);

            const allPlayersReady = playerList.filter(p => !p.isOwner).every(p => p.isReady);
            const canStart = allPlayersReady && room.players.size >= 2;
            
            for (const [, connectedSocket] of stopNamespace.sockets.entries()) {
                if (connectedSocket.request.user.id === room.ownerId) {
                    connectedSocket.emit('ownerCanStart', canStart);
                    break;
                }
            }
        }
    });

    socket.on('startGame', () => {
        const user = socket.request.user;
        const roomId = socket.roomId;
        const room = stopRooms[roomId];
        if (!room || !user || user.id !== room.ownerId) return;

        room.status = 'Jogando';
        room.gameState.currentRound++;
        room.gameState.answers = {}; 
        room.players.forEach(p => { p.isReady = p.isOwner; });
        
        const alphabet = "ABCDEFGHIJKLMNOPRSTUVZ";
        room.gameState.currentLetter = alphabet[Math.floor(Math.random() * alphabet.length)];
        const duration = 120;
        
        stopNamespace.to(roomId).emit('roundStart', { round: room.gameState.currentRound, letter: room.gameState.currentLetter, categories: room.categories, duration: duration });

        clearTimeout(room.gameState.roundTimer);
        room.gameState.roundTimer = setTimeout(() => {
            if (stopRooms[roomId] && stopRooms[roomId].status === 'Jogando') stopNamespace.to(roomId).emit('roundEnd', { initiator: 'Tempo Esgotado' });
        }, duration * 1000);
        stopNamespace.emit('updateRoomList', getLobbyRooms());
    });

    socket.on('playerPressedStop', () => {
        const user = socket.request.user;
        const roomId = socket.roomId;
        if (stopRooms[roomId] && stopRooms[roomId].status === 'Jogando') {
            clearTimeout(stopRooms[roomId].gameState.roundTimer);
            stopNamespace.to(roomId).emit('roundEnd', { initiator: user.nickname });
        }
    });

    socket.on('submitAnswers', (answers) => {
        const user = socket.request.user;
        const roomId = socket.roomId;
        const room = stopRooms[roomId];
        if (!room || !user || !room.players.has(user.id)) return;
        
        room.gameState.answers[user.id] = answers;
        const answeredPlayers = Object.keys(room.gameState.answers);
        const activePlayers = Array.from(room.players.keys());
        
        if (answeredPlayers.length === activePlayers.length) {
            const allAnswers = room.gameState.answers;
            const roundScores = {};
            activePlayers.forEach(pId => { roundScores[pId] = { scores: {}, total: 0 }; room.categories.forEach(cat => roundScores[pId].scores[cat] = 0); });

            room.categories.forEach(cat => {
                const categoryAnswers = {};
                activePlayers.forEach(pId => { const ans = (allAnswers[pId]?.[cat] || '').trim().toLowerCase(); if (ans) { if (!categoryAnswers[ans]) categoryAnswers[ans] = []; categoryAnswers[ans].push(pId); } });
                for (const ans in categoryAnswers) {
                    const playersWithAns = categoryAnswers[ans];
                    if (ans.startsWith(room.gameState.currentLetter.toLowerCase())) {
                        const score = playersWithAns.length > 1 ? 5 : 10;
                        playersWithAns.forEach(pId => roundScores[pId].scores[cat] = score);
                    }
                }
            });

            activePlayers.forEach(pId => { const player = room.players.get(pId); let total = Object.values(roundScores[pId].scores).reduce((sum, s) => sum + s, 0); roundScores[pId].total = total; player.score += total; });
            
            room.gameState.roundScores = roundScores;
            const isFinalRound = room.gameState.currentRound >= room.totalRounds;
            stopNamespace.to(roomId).emit('roundResults', { round: room.gameState.currentRound, roundScores, allAnswers, participants: Array.from(room.players.values()), isFinalRound });

            if (isFinalRound) {
                const winner = [...room.players.values()].reduce((p, c) => (p.score > c.score) ? p : c);
                winner.wins = (winner.wins || 0) + 1;
                stopNamespace.to(roomId).emit('gameOver', { winner });
                room.status = 'Finalizado';
            } else {
                room.status = 'Aguardando';
            }
            stopNamespace.emit('updateRoomList', getLobbyRooms());
        }
    });

    socket.on('requestNewGame', () => {
        const user = socket.request.user;
        const roomId = socket.roomId;
        const room = stopRooms[roomId];
        if (!room || !user || user.id !== room.ownerId) return;

        room.status = 'Aguardando';
        room.gameState.currentRound = 0;
        room.players.forEach(p => { p.score = 0; p.isReady = p.isOwner; });

        room.players.forEach(p => {
             for (const [, sock] of stopNamespace.sockets.entries()) {
                if (sock.request.user.id === p.id) {
                     sock.emit('roomInfo', {
                        name: room.name, isOwner: p.isOwner, categories: room.categories, maxParticipants: room.maxParticipants,
                        totalRounds: room.totalRounds, isPrivate: room.isPrivate, ownerNickname: room.ownerNickname, currentRound: 0, isSpectating: false
                    });
                    break;
                }
            }
        });
        const playerList = Array.from(room.players.values());
        stopNamespace.to(roomId).emit('updatePlayerList', playerList);
        stopNamespace.emit('updateRoomList', getLobbyRooms());
    });
    
    socket.on('stopMessage', (data) => {
        const user = socket.request.user;
        const roomId = socket.roomId;
        const room = stopRooms[roomId];
        if (!room || !user) return;
        const message = { nickname: user.nickname, text: data.text, mentions: data.mentions, color: '#333' };
        room.chatHistory.push(message);
        if (room.chatHistory.length > 50) room.chatHistory.shift();
        stopNamespace.to(roomId).emit('newStopMessage', message);
    });

    socket.on('disconnect', () => {
        const user = socket.request.user;
        const roomId = socket.roomId;

        if (user && roomId && stopRooms[roomId]) {
            const room = stopRooms[roomId];
            room.players.delete(user.id);

            if (room.players.size === 0 || user.id === room.ownerId) {
                clearTimeout(room.gameState.roundTimer);
                delete stopRooms[roomId];
                stopNamespace.emit('updateRoomList', getLobbyRooms());
                stopNamespace.to(roomId).emit('ownerDestroyedRoom');
            } else {
                if (room.status === 'Jogando') socket.emit('submitAnswers', {});
                const playerList = Array.from(room.players.values());
                stopNamespace.to(roomId).emit('updatePlayerList', playerList);
                stopNamespace.emit('updateRoomList', getLobbyRooms());
                
                const allPlayersReady = playerList.filter(p => !p.isOwner).every(p => p.isReady);
                const canStart = allPlayersReady && room.players.size >= 2;
                for (const [, sock] of stopNamespace.sockets.entries()) {
                    if (sock.request.user.id === room.ownerId) { sock.emit('ownerCanStart', canStart); break; }
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