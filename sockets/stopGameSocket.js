// sockets/stopGameSocket.js
const { v4: uuidv4 } = require('uuid');

// Constantes do Jogo
const ALPHABET = "ABCDEFGHIJKLMNOPRSTUVZ";
const ROUND_DURATION = 300;
const CHAT_COLORS = ['#E53935', '#D81B60', '#8E24AA', '#5E35B1', '#3949AB', '#1E88E5', '#039BE5', '#00ACC1', '#00897B', '#43A047', '#7CB342', '#FDD835', '#FFB300', '#FB8C00', '#F4511E', '#000000'];

// Estado das salas do jogo
const stopRooms = {};

function handleStopGameConnection(stopGameNamespace, prisma, io) {

    // --- FUNÇÕES GLOBAIS DO JOGO ---
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
    
    // --- LÓGICA DE CONEXÃO DO SOCKET ---
    stopGameNamespace.on('connection', (socket) => {
        const loggedInUser = socket.request.user;
        if (!loggedInUser) return socket.disconnect();
        
        // --- FUNÇÃO AUXILIAR ADICIONADA ---
        // Esta função pega o ID da sala e do usuário armazenados no socket
        function getSocketInfo(socketInstance) {
            return { 
                roomId: socketInstance.stopRoomId, 
                userId: socketInstance.stopUserId 
            };
        }

        broadcastStopPlayerCount();
        socket.emit('updateRoomList', getSanitizedRoomList());

        socket.on('createRoom', (details) => {
            const roomId = uuidv4();
            const { id, nickname } = loggedInUser;

            stopRooms[roomId] = {
                id: roomId, name: details.name, ownerId: id, participants: {},
                maxParticipants: details.maxParticipants, isPrivate: details.isPrivate,
                password: details.password, categories: details.categories, gameState: 'Aguardando',
                status: 'Aguardando', currentRound: 0, totalRounds: 5, chatHistory: []
            };

            const randomColor = CHAT_COLORS[Math.floor(Math.random() * CHAT_COLORS.length)];
            stopRooms[roomId].participants[id] = { id, nickname, score: 0, socketId: socket.id, isReady: false, wins: 0, color: randomColor };

            stopGameNamespace.emit('updateRoomList', getSanitizedRoomList());
            socket.emit('joinSuccess', roomId);
        });

        socket.on('playerPressedStop', () => {
            const { roomId } = getSocketInfo(socket);
            const room = stopRooms[roomId];
            if (room && room.gameState === 'Jogando') {
                endRound(roomId, loggedInUser.nickname); 
            }
        });

        socket.on('joinRoom', ({ roomId, password }) => {
            const room = stopRooms[roomId];
            if (!room) return socket.emit('error', 'Sala não encontrada.');
            if (room.gameState !== 'Aguardando' && !room.participants[loggedInUser.id]) return socket.emit('error', 'Não é possível entrar na sala. Existe um jogo em andamento.');
            if (room.isPrivate && room.password !== password) return socket.emit('error', 'Senha incorreta.');
            if (Object.keys(room.participants).length >= room.maxParticipants && !room.participants[loggedInUser.id]) return socket.emit('error', 'Esta sala está cheia.');
            socket.emit('joinSuccess', roomId);
        });
        
        socket.on('playerReady', ({ roomId }) => {
            const room = stopRooms[roomId];
            if (!room) return socket.emit('error', 'A sala que você tentou acessar não existe mais.');

            const { id, nickname } = loggedInUser;
            socket.join(roomId);
            socket.stopRoomId = roomId; // Armazena o ID da sala no socket
            socket.stopUserId = id;     // Armazena o ID do usuário no socket

            const isReconnecting = !!room.participants[id];
            
            if (isReconnecting) {
                clearTimeout(room.participants[id].disconnectTimer);
                room.participants[id].socketId = socket.id;
            } else {
                const randomColor = CHAT_COLORS[Math.floor(Math.random() * CHAT_COLORS.length)];
                room.participants[id] = { id, nickname, score: 0, socketId: socket.id, isReady: false, wins: 0, color: randomColor };
            }
            
            const ownerNickname = room.participants[room.ownerId]?.nickname || 'Desconhecido';
            const isSpectating = !isReconnecting && room.gameState !== 'Aguardando';
            
            const socketInstance = stopGameNamespace.sockets.get(socket.id);
            if (!socketInstance) return;

            socketInstance.emit('roomInfo', { 
                name: room.name, isOwner: String(room.ownerId) === String(id), categories: room.categories,
                isPrivate: room.isPrivate, ownerNickname: ownerNickname, maxParticipants: room.maxParticipants,
                totalRounds: room.totalRounds, currentRound: room.currentRound, isSpectating: isSpectating
            });
            
            switch(room.gameState) {
                case 'Jogando':
                    const remainingTime = room.roundEndTime ? Math.max(0, Math.round((room.roundEndTime - Date.now()) / 1000)) : ROUND_DURATION;
                    socketInstance.emit('roundStart', { letter: room.currentLetter, round: room.currentRound, categories: room.categories, duration: remainingTime });
                    break;
                case 'Validando':
                    if (room.lastResultsPayload) socketInstance.emit('roundResults', room.lastResultsPayload);
                    break;
            }

            socketInstance.emit('stopChatHistory', room.chatHistory);
            updatePlayerListAndCheckReadyState(roomId);
            stopGameNamespace.emit('updateRoomList', getSanitizedRoomList());
            broadcastStopPlayerCount();
        });

        socket.on('disconnect', () => {
            const { roomId, userId } = getSocketInfo(socket);
            const room = stopRooms[roomId];
            if (!roomId || !userId || !room || !room.participants[userId]) return;

            const player = room.participants[userId];
            player.disconnectTimer = setTimeout(async () => {
                if (stopRooms[roomId] && stopRooms[roomId].participants[userId] && stopRooms[roomId].participants[userId].socketId === socket.id) {
                    const wasOwner = String(room.ownerId) === String(userId);
                    
                    if (wasOwner) {
                        stopGameNamespace.to(roomId).emit('ownerDestroyedRoom');
                        delete stopRooms[roomId];
                    } else {
                        delete room.participants[userId];
                        if (room.gameState === 'Validando') {
                            const answeredPlayerIds = Object.keys(room.roundAnswers || {});
                            const playersInGame = Object.values(room.participants).filter(p => !p.wasSpectating);
                            if (playersInGame.every(p => answeredPlayerIds.includes(String(p.id)))) {
                                calculateScores(roomId);
                            }
                        }
                        updatePlayerListAndCheckReadyState(roomId);
                    }
                    
                    try {
                        await prisma.user.update({
                            where: { id: userId },
                            data: { isOnline: false, lastSeen: new Date() },
                        });
                        console.log(`Usuário ${loggedInUser.nickname} (ID: ${userId}) marcado como offline após timeout.`);
                    } catch (error) {
                        console.error(`Falha ao marcar usuário ${loggedInUser.nickname} como offline:`, error);
                    }
                    
                    stopGameNamespace.emit('updateRoomList', getSanitizedRoomList());
                    broadcastStopPlayerCount();
                }
            }, 5000);
        });

        socket.on('toggleReady', () => {
            const { roomId, userId } = getSocketInfo(socket);
            const room = stopRooms[roomId];
            if (room?.participants[userId]) {
                room.participants[userId].isReady = !room.participants[userId].isReady;
                updatePlayerListAndCheckReadyState(roomId);
            }
        });

        socket.on('startGame', () => {
            const { roomId, userId } = getSocketInfo(socket);
            const room = stopRooms[roomId];
            if (room && String(room.ownerId) === String(userId) && (room.gameState === 'Aguardando' || room.gameState === 'Validando')) {
                const allReady = Object.values(room.participants).every(p => String(p.id) === String(room.ownerId) || p.isReady);
                if (allReady && Object.keys(room.participants).length > 1) {
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
            const { roomId } = getSocketInfo(socket);
            const room = stopRooms[roomId];
            if (!room) return;
            room.gameState = 'Aguardando';
            room.currentRound = 0;
            room.lastResultsPayload = null;
            Object.values(room.participants).forEach(p => { p.score = 0; p.isReady = false; p.wasSpectating = false; });
            const ownerNickname = room.participants[room.ownerId]?.nickname || 'Desconhecido';
            Object.values(room.participants).forEach(p => {
                const socketInstance = stopGameNamespace.sockets.get(p.socketId);
                if (socketInstance) {
                    socketInstance.emit('roomInfo', { name: room.name, isOwner: String(room.ownerId) === String(p.id), categories: room.categories, isPrivate: room.isPrivate, ownerNickname: ownerNickname, maxParticipants: room.maxParticipants, totalRounds: room.totalRounds, currentRound: room.currentRound, isSpectating: false });
                }
            });
            updatePlayerListAndCheckReadyState(roomId);
        });
        
        socket.on('submitAnswers', (answers) => {
            const { roomId, userId } = getSocketInfo(socket);
            const room = stopRooms[roomId];
            if (room?.participants[userId] && room.gameState === 'Validando') {
                if (!room.roundAnswers) room.roundAnswers = {};
                room.roundAnswers[userId] = answers;
                const answeredPlayerIds = Object.keys(room.roundAnswers);
                const playersInGame = Object.values(room.participants).filter(p => !p.wasSpectating);
                if (playersInGame.every(p => answeredPlayerIds.includes(String(p.id)))) calculateScores(roomId);
            }
        });
        
        socket.on('ownerInvalidateAnswer', (data) => {
            const { roomId, userId } = getSocketInfo(socket);
            const room = stopRooms[roomId];
            const { playerId, category } = data;
            if (!room || String(room.ownerId) !== String(userId) || room.gameState !== 'Validando') return;
            const playerToUpdate = room.participants[playerId];
            const scoresToUpdate = room.roundScores[playerId];
            if (playerToUpdate && scoresToUpdate && scoresToUpdate.scores[category] !== undefined) {
                const oldScore = scoresToUpdate.scores[category];
                scoresToUpdate.scores[category] = 0;
                scoresToUpdate.total -= oldScore;
                playerToUpdate.score -= oldScore;
                const resultsPayload = { round: room.currentRound, roundScores: room.roundScores, allAnswers: room.roundAnswers, participants: Object.values(room.participants).map(p => ({ ...p, isOwner: String(room.ownerId) === String(p.id) })), isFinalRound: room.currentRound >= room.totalRounds };
                room.lastResultsPayload = resultsPayload;
                stopGameNamespace.to(roomId).emit('roundResults', resultsPayload);
                updatePlayerListAndCheckReadyState(roomId);
            }
        });
        
        socket.on('stopMessage', (data) => {
            const { roomId, userId } = getSocketInfo(socket);
            const room = stopRooms[roomId];
            if (!room) return;
            const senderColor = room.participants[userId]?.color || '#000000';
            const message = { nickname: loggedInUser.nickname, text: data.text, color: senderColor, mentions: data.mentions, timestamp: new Date() };
            room.chatHistory.push(message);
            if (room.chatHistory.length > 50) room.chatHistory.shift();
            stopGameNamespace.to(roomId).emit('newStopMessage', message);
        });

        socket.on('ownerUpdateRoomSettings', (newSettings) => {
            const { roomId, userId } = getSocketInfo(socket); // Agora esta função existe
            const room = stopRooms[roomId];
            if (!room || String(room.ownerId) !== String(userId) || room.gameState !== 'Aguardando') return socket.emit('settingsError', 'Você não pode alterar as configurações agora.');
            if (!newSettings.name?.trim()) return socket.emit('settingsError', "O nome da sala não pode ser vazio.");
            if (!newSettings.categories || newSettings.categories.length < 1) return socket.emit('settingsError', "A sala deve ter pelo menos uma categoria.");
            if (newSettings.maxParticipants < Object.keys(room.participants).length) return socket.emit('settingsError', 'O máximo de participantes não pode ser menor que a quantidade atual na sala.');
            if (newSettings.isPrivate && !newSettings.password && !room.password) return socket.emit('settingsError', 'Salas privadas precisam de senha.');

            Object.assign(room, {
                name: newSettings.name.trim(),
                isPrivate: newSettings.isPrivate,
                password: newSettings.password || room.password,
                categories: newSettings.categories,
                maxParticipants: newSettings.maxParticipants,
                totalRounds: newSettings.totalRounds,
            });

            const ownerNick = room.participants[room.ownerId]?.nickname || 'Desconhecido';
            Object.values(room.participants).forEach(p => {
                const socketInstance = stopGameNamespace.sockets.get(p.socketId);
                if (socketInstance) socketInstance.emit('roomInfo', { name: room.name, isOwner: String(room.ownerId) === String(p.id), categories: room.categories, isPrivate: room.isPrivate, ownerNickname: ownerNick, maxParticipants: room.maxParticipants, totalRounds: room.totalRounds, currentRound: room.currentRound });
            });
            stopGameNamespace.emit('updateRoomList', getSanitizedRoomList());
        });
    });

    // --- FUNÇÕES DE CONTROLE DO JOGO STOP! ---
    // (As funções abaixo permanecem as mesmas)

    function updatePlayerListAndCheckReadyState(roomId) {
        const room = stopRooms[roomId];
        if (!room) return;
        const playerList = Object.values(room.participants).map(p => ({ nickname: p.nickname, score: p.score, isOwner: String(room.ownerId) === String(p.id), isReady: p.isReady, wins: p.wins || 0 }));
        stopGameNamespace.to(roomId).emit('updatePlayerList', playerList);
        const participantsArray = Object.values(room.participants);
        const allPlayersReady = participantsArray.length > 1 && participantsArray.every(p => String(p.id) === String(room.ownerId) || p.isReady);
        const ownerSocket = room.participants[room.ownerId] ? stopGameNamespace.sockets.get(room.participants[room.ownerId].socketId) : null;
        if (ownerSocket) ownerSocket.emit('ownerCanStart', allPlayersReady);
    }
    
    function startGame(roomId) {
        const room = stopRooms[roomId];
        if (!room) return;
        Object.assign(room, { gameState: 'Jogando', status: 'Jogando', currentRound: room.currentRound + 1, roundAnswers: {}, lastResultsPayload: null, roundEndTime: Date.now() + ROUND_DURATION * 1000 });
        Object.values(room.participants).forEach(p => { p.isReady = false; p.wasSpectating = p.isSpectating || false; p.isSpectating = false; });
        room.currentLetter = ALPHABET.charAt(Math.floor(Math.random() * ALPHABET.length));
        stopGameNamespace.to(roomId).emit('roundStart', { letter: room.currentLetter, round: room.currentRound, categories: room.categories, duration: ROUND_DURATION });
        room.roundTimeout = setTimeout(() => endRound(roomId, 'Tempo'), ROUND_DURATION * 1000);
        stopGameNamespace.emit('updateRoomList', getSanitizedRoomList());
    }

    function endRound(roomId, initiator) {
        const room = stopRooms[roomId];
        if (!room || room.gameState !== 'Jogando') return;
        Object.assign(room, { gameState: 'Validando', status: 'Validando' });
        clearTimeout(room.roundTimeout);
        const playersInGame = Object.values(room.participants).filter(p => !p.wasSpectating).map(p => String(p.id));
        stopGameNamespace.to(roomId).emit('roundEnd', { initiator, playersInGame });
        stopGameNamespace.emit('updateRoomList', getSanitizedRoomList());
    }

    function calculateScores(roomId) {
        const room = stopRooms[roomId];
        if (!room || !room.participants || Object.keys(room.participants).length === 0) return;
        const { roundAnswers, participants, categories } = room;
        room.roundScores = {};
        const { roundScores } = room;
        const participantIds = Object.keys(participants);
        participantIds.forEach(id => { roundScores[id] = { total: 0, scores: {} }; });
        const playersWhoPlayed = participantIds.filter(id => participants[id] && !participants[id].wasSpectating);
        if (playersWhoPlayed.length > 0) {
            categories.forEach(category => {
                const wordCounts = {};
                playersWhoPlayed.forEach(userId => {
                    const answer = roundAnswers[userId]?.[category]?.trim().toLowerCase();
                    if (answer?.startsWith(room.currentLetter.toLowerCase())) wordCounts[answer] = (wordCounts[answer] || 0) + 1;
                });
                playersWhoPlayed.forEach(userId => {
                    const answer = roundAnswers[userId]?.[category]?.trim().toLowerCase();
                    let score = 0;
                    if (answer?.startsWith(room.currentLetter.toLowerCase())) score = (wordCounts[answer] === 1) ? 10 : 5;
                    if (roundScores[userId]) {
                        roundScores[userId].scores[category] = score;
                        roundScores[userId].total += score;
                    }
                });
            });
        }
        playersWhoPlayed.forEach(userId => {
            if (participants[userId] && roundScores[userId]) participants[userId].score += roundScores[userId].total;
        });
        const resultsPayload = { round: room.currentRound, roundScores, allAnswers: roundAnswers || {}, participants: Object.values(participants).map(p => ({ ...p, isOwner: String(room.ownerId) === String(p.id) })), isFinalRound: room.currentRound >= room.totalRounds };
        room.lastResultsPayload = resultsPayload;
        stopGameNamespace.to(roomId).emit('roundResults', resultsPayload);
        Object.values(participants).forEach(p => { p.isReady = false; });
        updatePlayerListAndCheckReadyState(roomId);
    }
}

module.exports = { handleStopGameConnection };