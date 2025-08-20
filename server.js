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
const { v4: uuidv4 } = require('uuid');
const PgSimple = require('connect-pg-simple')(session);
const { PrismaClient } = require('@prisma/client');

// --- INICIALIZAÇÃO E CONFIGURAÇÃO ---
const prisma = new PrismaClient();
const app = express();
const server = http.createServer(app);
const io = new Server(server);

// --- MIDDLEWARES DO EXPRESS ---
app.set('trust proxy', 1);
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));
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


// --- COMPARTILHANDO SESSÃO COM SOCKET.IO ---
const wrap = middleware => (socket, next) => middleware(socket.request, {}, next);
const stopGameNamespace = io.of('/stop');
stopGameNamespace.use(wrap(sessionMiddleware));
stopGameNamespace.use(wrap(passport.initialize()));
stopGameNamespace.use(wrap(passport.session()));


// --- ROTAS ---
const authRoutes = require('./routes/auth');
app.use('/', authRoutes);

function isAuthenticated(req, res, next) {
    if (req.isAuthenticated()) return next();
    res.redirect('/login.html');
}

app.get('/api/user/status', (req, res) => {
    if (req.isAuthenticated()) {
        res.json({ loggedIn: true, nickname: req.user.nickname, age: req.user.age });
    } else {
        res.json({ loggedIn: false });
    }
});

app.get('/stop-lobby.html', isAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'stop-lobby.html'));
});


// --- ESTADO DAS APLICAÇÕES E CONSTANTES ---
const chatRooms = {};
const stopRooms = {};
const ALPHABET = "ABCDEFGHIJKLMNOPRSTUVZ";
const ROUND_DURATION = 300;


// --- FUNÇÕES GLOBAIS ---
function broadcastStopPlayerCount() {
    let totalPlayers = 0;
    Object.values(stopRooms).forEach(room => {
        if (room && room.participants) {
            totalPlayers += Object.keys(room.participants).length;
        }
    });
    io.emit('stopPlayerCountUpdate', totalPlayers);
}

const getSanitizedRoomList = () => {
    return Object.values(stopRooms).map(r => ({
        id: r.id, name: r.name, participants: Object.keys(r.participants).length, 
        maxParticipants: r.maxParticipants, isPrivate: r.isPrivate, status: r.status
    }));
};

// --- LÓGICA DO SOCKET.IO (CHAT DE IDIOMAS - SEM LOGIN) ---
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

        if (!chatRooms[sala]) {
            chatRooms[sala] = { users: {}, history: [] };
        }
        if (Object.values(chatRooms[sala].users).find(u => u.nickname.toLowerCase() === nickname.toLowerCase())) {
            return socket.emit('nicknameTaken', { nickname });
        }
        if (Object.keys(chatRooms[sala].users).length >= 20) {
            return socket.emit('roomFull');
        }

        socket.join(sala);
        socket.sala = sala;
        socket.nickname = nickname;

        chatRooms[sala].users[socket.id] = { nickname, idade, color, status: 'online' };
        
        socket.emit('chatHistory', chatRooms[sala].history);
        io.to(sala).emit('userList', Object.values(chatRooms[sala].users));
        io.emit('roomCounts', Object.keys(chatRooms).reduce((acc, key) => {
            acc[key] = Object.keys(chatRooms[key].users).length;
            return acc;
        }, {}));
        
        resetIdleTimeout();
    });

    socket.on('message', (msg) => {
        if (socket.sala && socket.nickname) {
            const messageData = { 
                nickname: socket.nickname, 
                text: msg.text,
                color: chatRooms[socket.sala].users[socket.id]?.color,
                mentions: msg.mentions,
                imageData: msg.imageData
            };
            chatRooms[socket.sala].history.push(messageData);
            if (chatRooms[socket.sala].history.length > 100) {
                chatRooms[socket.sala].history.shift();
            }
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
            io.emit('roomCounts', Object.keys(chatRooms).reduce((acc, key) => {
                acc[key] = Object.keys(chatRooms[key].users).length;
                return acc;
            }, {}));
        }
    });
});


// --- LÓGICA DO SOCKET.IO (JOGO STOP! - COM LOGIN) ---
stopGameNamespace.on('connection', (socket) => {
    const loggedInUser = socket.request.user;
    if (!loggedInUser) return socket.disconnect();
    
    // Envia a contagem atual assim que um usuário se conecta ao namespace do lobby/jogo
    broadcastStopPlayerCount();
    socket.emit('updateRoomList', getSanitizedRoomList());

    socket.on('createRoom', (details) => {
        const roomId = uuidv4();
        stopRooms[roomId] = {
            id: roomId, name: details.name, ownerId: loggedInUser.id, participants: {},
            maxParticipants: details.maxParticipants, isPrivate: details.isPrivate, password: details.password,
            categories: details.categories, gameState: 'Aguardando', status: 'Aguardando', currentRound: 0,
            totalRounds: 5, chatHistory: []
        };
        stopGameNamespace.emit('updateRoomList', getSanitizedRoomList());
        socket.emit('joinSuccess', roomId);
    });

    socket.on('playerPressedStop', () => {
        const roomId = socket.stopRoomId;
        const room = stopRooms[roomId];
        if (room && room.gameState === 'Jogando') endRound(roomId, loggedInUser.nickname); 
    });
	
    socket.on('joinRoom', ({ roomId, password }) => {
        const room = stopRooms[roomId];
        if (!room) { return socket.emit('error', 'Sala não encontrada.'); }
        if (room.isPrivate && room.password !== password) { return socket.emit('error', 'Senha incorreta.'); }
        if (Object.keys(room.participants).length >= room.maxParticipants && !room.participants[loggedInUser.id]) { 
            return socket.emit('error', 'Esta sala está cheia.'); 
        }
        socket.emit('joinSuccess', roomId);
    });
    
    socket.on('playerReady', ({ roomId }) => {
        const room = stopRooms[roomId];
        if (!room) { return socket.emit('error', 'A sala que você tentou acessar não existe mais.'); }

        const { id, nickname } = loggedInUser;
        socket.join(roomId);
        socket.stopRoomId = roomId;
        socket.stopUserId = id;
		
        room.participants[id] = { id, nickname, score: 0, socketId: socket.id, isReady: false, wins: 0 };
        
        const ownerNickname = room.participants[room.ownerId]?.nickname || 'Desconhecido';
        const isSpectating = room.gameState !== 'Aguardando';

        socket.emit('roomInfo', { 
            name: room.name, isOwner: String(room.ownerId) === String(id), categories: room.categories,
            isPrivate: room.isPrivate, ownerNickname: ownerNickname, maxParticipants: room.maxParticipants,
            totalRounds: room.totalRounds, currentRound: room.currentRound, isSpectating: isSpectating
        });
        socket.emit('stopChatHistory', room.chatHistory);
        
        updatePlayerListAndCheckReadyState(roomId);
        stopGameNamespace.emit('updateRoomList', getSanitizedRoomList());
        broadcastStopPlayerCount();
    });

    socket.on('disconnect', () => {
        const roomId = socket.stopRoomId;
        const userId = socket.stopUserId;
        const room = stopRooms[roomId];

        if (!roomId || !userId || !room || !room.participants[userId]) return;

        const wasOwner = String(room.ownerId) === String(userId);
        
        delete room.participants[userId];
        
        let roomExists = true;
        if (Object.keys(room.participants).length === 0) {
            delete stopRooms[roomId];
            roomExists = false;
        } else {
            if (wasOwner) {
                stopGameNamespace.to(roomId).emit('ownerDestroyedRoom');
                delete stopRooms[roomId];
                roomExists = false;
            } else {
                if (room.gameState === 'Validando') {
                    const answeredPlayerIds = Object.keys(room.roundAnswers || {});
                    const playersInGame = Object.values(room.participants).filter(p => !p.wasSpectating);
                    if (playersInGame.every(p => answeredPlayerIds.includes(String(p.id)))) {
                        calculateScores(roomId);
                    }
                }
                updatePlayerListAndCheckReadyState(roomId);
            }
        }

        // Garante que a atualização seja enviada em todos os cenários de saída
        if(roomExists) {
            stopGameNamespace.emit('updateRoomList', getSanitizedRoomList());
        }
        broadcastStopPlayerCount();
    });
    
    // ... todos os outros listeners (toggleReady, startGame, submitAnswers, etc.) permanecem iguais ...
    socket.on('toggleReady', () => {
        const roomId = socket.stopRoomId;
        const userId = socket.stopUserId;
        const room = stopRooms[roomId];
        if (room && room.participants[userId]) {
            room.participants[userId].isReady = !room.participants[userId].isReady;
            updatePlayerListAndCheckReadyState(roomId);
        }
    });

    socket.on('startGame', () => {
        const roomId = socket.stopRoomId;
        const room = stopRooms[roomId];
        if (room && String(room.ownerId) === String(loggedInUser.id) && (room.gameState === 'Aguardando' || room.gameState === 'Validando')) {
            const allReady = Object.values(room.participants).every(p => String(p.id) === String(room.ownerId) || p.isReady);
            if(allReady && Object.keys(room.participants).length > 1) {
                if (room.currentRound >= room.totalRounds) {
                    const winner = Object.values(room.participants).sort((a, b) => b.score - a.score)[0];
                    if (winner) winner.wins = (winner.wins || 0) + 1;
                    stopGameNamespace.to(roomId).emit('gameOver', { winner });
                } else {
                    startGame(roomId);
                }
            } else {
                socket.emit('error', 'Nem todos os jogadores estão prontos ou não há jogadores suficientes!');
            }
        }
    });

    socket.on('requestNewGame', () => {
        const roomId = socket.stopRoomId;
        const room = stopRooms[roomId];
        if (!room) return;

        room.gameState = 'Aguardando';
        room.currentRound = 0;
        Object.values(room.participants).forEach(p => {
            p.score = 0;
            p.isReady = false;
            p.lastRoundScore = 0;
            p.wasSpectating = false;
        });

        const ownerNickname = room.participants[room.ownerId]?.nickname || 'Desconhecido';
        Object.values(room.participants).forEach(p => {
            const socketInstance = stopGameNamespace.sockets.get(p.socketId);
            if(socketInstance) {
                socketInstance.emit('roomInfo', { 
                    name: room.name, isOwner: String(room.ownerId) === String(p.id), categories: room.categories,
                    isPrivate: room.isPrivate, ownerNickname: ownerNickname, maxParticipants: room.maxParticipants,
                    totalRounds: room.totalRounds, currentRound: room.currentRound, isSpectating: false
                });
            }
        });
        updatePlayerListAndCheckReadyState(roomId);
    });

    socket.on('submitAnswers', (answers) => {
        const roomId = socket.stopRoomId;
        const room = stopRooms[roomId];
        if (room && room.participants[loggedInUser.id] && room.gameState === 'Validando') {
            if (!room.roundAnswers) room.roundAnswers = {};
            room.roundAnswers[loggedInUser.id] = answers;
            
            const answeredPlayerIds = Object.keys(room.roundAnswers);
            const playersInGame = Object.values(room.participants).filter(p => !p.wasSpectating);
            
            if (playersInGame.every(p => answeredPlayerIds.includes(String(p.id)))) {
                calculateScores(roomId);
            }
        }
    });

    socket.on('ownerInvalidateAnswer', (data) => {
        const roomId = socket.stopRoomId;
        const room = stopRooms[roomId];
        const userId = socket.stopUserId;
        const { playerId, category } = data;

        if (!room || !userId || String(room.ownerId) !== String(userId) || room.gameState !== 'Validando') return;

        const playerToUpdate = room.participants[playerId];
        const scoresToUpdate = room.roundScores[playerId];

        if (playerToUpdate && scoresToUpdate && scoresToUpdate.scores[category] !== undefined) {
            const oldScore = scoresToUpdate.scores[category];
            scoresToUpdate.scores[category] = 0;
            scoresToUpdate.total -= oldScore;
            playerToUpdate.score -= oldScore;

            const resultsPayload = {
                round: room.currentRound, roundScores: room.roundScores, allAnswers: room.roundAnswers,
                participants: Object.values(room.participants).map(p => ({...p, isOwner: String(room.ownerId) === String(p.id)})),
                isFinalRound: room.currentRound >= room.totalRounds
            };
            
            stopGameNamespace.to(roomId).emit('roundResults', resultsPayload);
            updatePlayerListAndCheckReadyState(roomId);
        }
    });
    
    socket.on('stopMessage', (data) => {
        const roomId = socket.stopRoomId;
        const room = stopRooms[roomId];
        if (!room) return;

        const message = {
            nickname: loggedInUser.nickname, text: data.text,
            mentions: data.mentions, timestamp: new Date()
        };
        room.chatHistory.push(message);
        if (room.chatHistory.length > 50) room.chatHistory.shift();

        stopGameNamespace.to(roomId).emit('newStopMessage', message);
    });

    socket.on('ownerUpdateRoomSettings', (newSettings) => {
        const roomId = socket.stopRoomId;
        const room = stopRooms[roomId];
        const userId = socket.stopUserId;
        const ownerNickname = loggedInUser.nickname;

        if (!room || !userId || String(room.ownerId) !== String(userId) || room.gameState !== 'Aguardando') {
            return socket.emit('settingsError', 'Você não pode alterar as configurações agora.');
        }

        if (!newSettings.name || !newSettings.name.trim()) return socket.emit('settingsError', "O nome da sala não pode ser vazio.");
        if (!newSettings.categories || newSettings.categories.length < 1) return socket.emit('settingsError', "A sala deve ter pelo menos uma categoria.");
        if (newSettings.maxParticipants < Object.keys(room.participants).length) return socket.emit('settingsError', 'O máximo de participantes não pode ser menor que a quantidade atual na sala.');
        if (newSettings.isPrivate && !newSettings.password && !room.password) return socket.emit('settingsError', 'Salas privadas precisam de senha.');

        const logs = [];
        if (room.name !== newSettings.name.trim()) logs.push(`${ownerNickname} alterou o nome da sala para "${newSettings.name.trim()}".`);
        if (room.isPrivate !== newSettings.isPrivate) logs.push(`${ownerNickname} alterou a sala para ${newSettings.isPrivate ? 'Privada' : 'Pública'}.`);
        if (room.maxParticipants !== newSettings.maxParticipants) logs.push(`${ownerNickname} alterou o máximo de jogadores para ${newSettings.maxParticipants}.`);
        if (room.totalRounds !== newSettings.totalRounds) logs.push(`${ownerNickname} alterou o número de rodadas para ${newSettings.totalRounds}.`);
        
        room.name = newSettings.name.trim();
        room.isPrivate = newSettings.isPrivate;
        if (newSettings.password) room.password = newSettings.password;
        
        room.categories = newSettings.categories;
        room.maxParticipants = newSettings.maxParticipants;
        room.totalRounds = newSettings.totalRounds;

        logs.forEach(log => {
            const message = { nickname: 'Sistema', text: log, isSystemMessage: true, timestamp: new Date() };
            room.chatHistory.push(message);
            stopGameNamespace.to(roomId).emit('newStopMessage', message);
        });

        const ownerNick = room.participants[room.ownerId]?.nickname || 'Desconhecido';
        Object.values(room.participants).forEach(p => {
            const socketInstance = stopGameNamespace.sockets.get(p.socketId);
            if (socketInstance) {
                const roomInfoPayload = {
                    name: room.name, isOwner: String(room.ownerId) === String(p.id), categories: room.categories,
                    isPrivate: room.isPrivate, ownerNickname: ownerNick, maxParticipants: room.maxParticipants, totalRounds: room.totalRounds
                };
                socketInstance.emit('roomInfo', roomInfoPayload);
            }
        });

        stopGameNamespace.emit('updateRoomList', getSanitizedRoomList());
    });
});

// FUNÇÕES DE CONTROLE DO JOGO STOP!
function updatePlayerListAndCheckReadyState(roomId) {
    const room = stopRooms[roomId];
    if (!room) return;

    const playerList = Object.values(room.participants).map(p => ({
        nickname: p.nickname, score: p.score, isOwner: String(room.ownerId) === String(p.id),
        isReady: p.isReady, wins: p.wins || 0
    }));
    stopGameNamespace.to(roomId).emit('updatePlayerList', playerList);
    
    const participantsArray = Object.values(room.participants);
    const allPlayersReady = participantsArray.length > 1 && participantsArray.every(p => {
        return String(p.id) === String(room.ownerId) || p.isReady;
    });

    const ownerSocket = room.participants[room.ownerId] ? stopGameNamespace.sockets.get(room.participants[room.ownerId].socketId) : null;
    if (ownerSocket) {
        ownerSocket.emit('ownerCanStart', allPlayersReady);
    }
}

function startGame(roomId) {
    const room = stopRooms[roomId];
    if (!room) return;
    room.gameState = 'Jogando';
    room.status = 'Jogando';
    room.currentRound++;
    room.roundAnswers = {};
    Object.values(room.participants).forEach(p => { 
        p.isReady = false;
        p.wasSpectating = p.isSpectating || false;
        p.isSpectating = false;
     });
    const letter = ALPHABET.charAt(Math.floor(Math.random() * ALPHABET.length));
    room.currentLetter = letter;

    stopGameNamespace.to(roomId).emit('roundStart', {
        letter, round: room.currentRound, categories: room.categories, duration: ROUND_DURATION
    });
    room.roundTimeout = setTimeout(() => { endRound(roomId, 'Tempo'); }, ROUND_DURATION * 1000);
    stopGameNamespace.emit('updateRoomList', getSanitizedRoomList());
}

function endRound(roomId, initiator) {
    const room = stopRooms[roomId];
    if (!room || room.gameState !== 'Jogando') return;
    room.gameState = 'Validando';
    room.status = 'Validando';
    clearTimeout(room.roundTimeout);
    
    const playersInGame = Object.values(room.participants).filter(p => !p.wasSpectating).map(p => String(p.id));
    stopGameNamespace.to(roomId).emit('roundEnd', { initiator, playersInGame });
    stopGameNamespace.emit('updateRoomList', getSanitizedRoomList());
}

function calculateScores(roomId) {
    const room = stopRooms[roomId];
    if (!room) return;
    const { roundAnswers, participants, categories } = room;
    room.roundScores = {}; 
    const roundScores = room.roundScores;
    
    const participantIds = Object.keys(participants);
    participantIds.forEach(id => {
        roundScores[id] = { total: 0, scores: {} };
    });

    const playersWhoPlayed = participantIds.filter(id => participants[id] && !participants[id].wasSpectating);

    categories.forEach(category => {
        const wordCounts = {};
        playersWhoPlayed.forEach(userId => {
            const answer = roundAnswers[userId]?.[category]?.trim().toLowerCase();
            if (answer && answer.startsWith(room.currentLetter.toLowerCase())) {
                wordCounts[answer] = (wordCounts[answer] || 0) + 1;
            }
        });

        playersWhoPlayed.forEach(userId => {
            const answer = roundAnswers[userId]?.[category]?.trim().toLowerCase();
            let score = 0;
            if (answer && answer.startsWith(room.currentLetter.toLowerCase())) {
                score = (wordCounts[answer] === 1) ? 10 : 5;
            }
            if(roundScores[userId]) {
                roundScores[userId].scores[category] = score;
                roundScores[userId].total += score;
            }
        });
    });

    participantIds.forEach(userId => {
        if (participants[userId] && roundScores[userId]) {
            participants[userId].score -= (participants[userId].lastRoundScore || 0);
            participants[userId].lastRoundScore = roundScores[userId].total;
            participants[userId].score += roundScores[userId].total;
        }
    });

    const resultsPayload = {
        round: room.currentRound,
        roundScores,
        allAnswers: roundAnswers,
        participants: Object.values(participants).map(p => ({...p, isOwner: String(room.ownerId) === String(p.id)})),
        isFinalRound: room.currentRound >= room.totalRounds
    };
    stopGameNamespace.to(roomId).emit('roundResults', resultsPayload);
    
    Object.values(participants).forEach(p => { p.isReady = false; });

    updatePlayerListAndCheckReadyState(roomId);
    stopGameNamespace.emit('updateRoomList', getSanitizedRoomList());
}

// --- INICIALIZAÇÃO DO SERVIDOR ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});