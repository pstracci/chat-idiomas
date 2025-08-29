// server.js (COMPLETO E COM LÓGICA DE MEMÓRIA APRIMORADA)

console.log('--- EXECUTANDO A VERSÃO MAIS RECENTE DO SERVER.JS ---');

if (process.env.NODE_ENV !== "production") {
    require("dotenv").config();
}

// =======================================================================
// == INÍCIO DA NOVA CONFIGURAÇÃO DE PROMPTS DO VERBI ==
// =======================================================================

// 1. DEFINA A PERSONALIDADE DO VERBI AQUI
const VERBI_PERSONALITY_RULES = `
Você é o Verbi, um tutor de idiomas amigável, paciente e encorajador do site Verbi.
Sua principal função é motivar os usuários a praticar.

- Regras de Comportamento:
- Seja sempre positivo e didático e engraçado.
- Use emojis para deixar a conversa mais leve.
- Se um usuário errar, corrija-o de forma gentil, explicando o porquê do erro.
- Faça perguntas para estimular a continuação da conversa.
- Mantenha as respostas relativamente curtas e diretas.
- Você é um robô. Não sabe que é uma I.A.
- Você tem comportamento de robô. Não entende muito bem ironias.
- Se alguem tenta sair do tema você desconversa e tenta voltar ao assunto principal.
- Se alguém te tratar mal ou com desdém, você não aceita calado, retribui na mesma moeda, com sarcasmo.

- Regras de Memória e Contexto:
- O histórico da conversa será fornecido a você. As mensagens dos usuários são prefixadas com seus nicknames (ex: 'ricardofjr: ...'). Preste MUITA atenção nesses nicknames para saber quem disse o quê.
- VOCÊ DEVE se lembrar de fatos que os usuários te contam (nomes, nomes de pets, hobbies, etc.).
- Quando um usuário perguntar algo como "qual é o nome do meu cachorro?", você DEVE olhar o histórico para encontrar a resposta que ele já te deu.
- NÃO peça por uma informação que já foi fornecida no histórico recente. Use a sua memória para responder diretamente.
`;

// 2. MAPEAMENTO DAS SALAS E SEUS RESPECTIVOS IDIOMAS
const LANGUAGE_CONFIG = {
    ingles: "Inglês",
    espanhol: "Espanhol",
    frances: "Francês",
    alemao: "Alemão",
    portugues: "Português",
    japones: "Japonês",
    sueco: "Sueco",
    italiano: "Italiano",
    arabe: "Árabe"
};

// 3. FUNÇÃO QUE GERA OS PROMPTS DINAMICAMENTE
function generateRoomPrompts(config, personality) {
    const prompts = {};
    for (const key in config) {
        const languageName = config[key];
        prompts[key] = `
            ${personality.trim()}

            Seu objetivo principal nesta sala é ajudar os usuários a praticarem ${languageName}.
            Responda às perguntas, ajude-os a formar frases, corrija a gramática e a expandir o vocabulário, sempre no idioma ${languageName}.
            Nunca se desvie do papel de tutor de ${languageName}. Se a pergunta não for sobre o idioma, peça gentilmente para voltarem ao tópico.
        `.replace(/\s+/g, ' ').trim();
    }
    return prompts;
}
// 4. CRIAÇÃO DO OBJETO FINAL DE PROMPTS
const roomPrompts = generateRoomPrompts(LANGUAGE_CONFIG, VERBI_PERSONALITY_RULES);

// =======================================================================
// == FIM DA NOVA CONFIGURAÇÃO DE PROMPTS DO VERBI ==
// =======================================================================


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
const OpenAI = require('openai');

const prisma = new PrismaClient();
const app = express();
const corsOptions = { origin: 'https://www.verbi.com.br', optionsSuccessStatus: 200 };
const server = http.createServer(app);
const io = new Server({ maxHttpBufferSize: 5e6 });
io.attach(server);

const userSocketMap = {};
const videoCallState = {};
const chatRooms = {};
const messageHistory = new Map();
const spamBlockedUsers = new Map();
const SPAM_LIMIT = 5;
const SPAM_TIME_WINDOW = 10000;
const BLOCK_DURATION = 300000;
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

app.use(cors(corsOptions));
app.set('trust proxy', 1);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
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
const authRoutes = require('./routes/auth');
const profileRoutes = require('./routes/profile');
const videoRoutes = require('./routes/video');
const notificationRoutes = require('./routes/notifications');
const learnRoutes = require('./routes/learn');
const adminRoutes = require('./routes/admin')(io);
const connectionsRoutes = require('./routes/connections')(io);
const dmRoutes = require('./routes/dm')(userSocketMap);
app.get('/api/user/status', async (req, res) => {
    if (req.isAuthenticated()) {
        try {
            const userId = req.user.id;
            const [userWithProfile, connections, notifications] = await Promise.all([
                prisma.user.findUnique({ where: { id: userId }, include: { profile: true } }),
                prisma.connection.findMany({
                    where: { status: 'ACCEPTED', OR: [{ requesterId: userId }, { addresseeId: userId }] },
                    include: {
                        requester: { select: { id: true, nickname: true, profile: { select: { profilePicture: true } } } },
                        addressee: { select: { id: true, nickname: true, profile: { select: { profilePicture: true } } } }
                    }
                }),
                prisma.notification.findMany({
                    where: { userId: userId, read: false },
                    orderBy: { createdAt: 'desc' },
                    include: {
                        relatedConnection: {
                            include: {
                                requester: { select: { id: true, nickname: true, profile: { select: { profilePicture: true } } } }
                            }
                        }
                    }
                })
            ]);
            const friendsData = [];
            if (connections.length > 0) {
                const friendIds = connections.map(conn => conn.requesterId === userId ? conn.addresseeId : conn.requesterId);
                const conversations = await prisma.conversation.findMany({
                    where: {
                        AND: [
                            { participants: { some: { B: userId } } },
                            { participants: { some: { B: { in: friendIds } } } }
                        ]
                    },
                    include: {
                        participants: {
                            select: { B: true }
                        }
                    }
                });
                const friendIdToConvIdMap = new Map();
                conversations.forEach(conv => {
                    const friendParticipant = conv.participants.find(p => p.B !== userId);
                    if (friendParticipant) {
                        friendIdToConvIdMap.set(friendParticipant.B, conv.id);
                    }
                });
                const conversationIds = Array.from(friendIdToConvIdMap.values());
                let unreadCountsMap = new Map();
                if (conversationIds.length > 0) {
                    const unreadCounts = await prisma.message.groupBy({
                        by: ['conversationId'],
                        where: {
                            conversationId: { in: conversationIds },
                            senderId: { not: userId },
                            read: false
                        },
                        _count: {
                            id: true
                        }
                    });
                    unreadCounts.forEach(item => {
                        unreadCountsMap.set(item.conversationId, item._count.id);
                    });
                }
                for (const conn of connections) {
                    const friend = conn.requesterId === userId ? conn.addressee : conn.requester;
                    const isOnline = userSocketMap[friend.id] && userSocketMap[friend.id].size > 0;
                    const conversationId = friendIdToConvIdMap.get(friend.id);
                    const unreadCount = unreadCountsMap.get(conversationId) || 0;
                    friendsData.push({
                        connectionId: conn.id,
                        friendInfo: {
                            id: friend.id,
                            nickname: friend.nickname,
                            profilePicture: friend.profile?.profilePicture,
                            isOnline: isOnline,
                            unreadCount: unreadCount
                        }
                    });
                }
            }
            const enrichedNotifications = notifications.map(n => {
                if (n.type === 'CONNECTION_REQUEST' && n.relatedConnection) {
                    return { ...n, requester: n.relatedConnection.requester };
                }
                return n;
            });
            res.json({
                loggedIn: true,
                user: { id: userWithProfile.id, nickname: userWithProfile.nickname, role: req.user.role, profile: userWithProfile.profile },
                connections: friendsData,
                notifications: enrichedNotifications
            });
        } catch (error) {
            console.error("Erro ao buscar status completo do usuário:", error);
            res.status(500).json({ loggedIn: false, error: 'Erro interno do servidor' });
        }
    } else {
        res.json({ loggedIn: false });
    }
});
app.get('/api/users/search', async (req, res) => {
    try {
        const { name, nickname, email, country, languageSpoken, languageLearning, ageRange, isOnline } = req.query;
        const prismaWhere = {};
        const profileWhere = {};
        if (name) {
            profileWhere.OR = [
                { firstName: { contains: name, mode: 'insensitive' } },
                { lastName: { contains: name, mode: 'insensitive' } }
            ];
        }
        if (nickname) {
            prismaWhere.nickname = { contains: nickname, mode: 'insensitive' };
        }
        if (email) {
            prismaWhere.email = { contains: email, mode: 'insensitive' };
        }
        if (isOnline === 'true') {
            prismaWhere.isOnline = true;
        }
        if (country) {
            profileWhere.country = { equals: country, mode: 'insensitive' };
        }
		if (languageSpoken) {
			profileWhere.OR = [
				{ languagesSpoken: { array_contains: [languageSpoken] } },
				{ languagesSpoken: { array_contains: [{ language: languageSpoken }] } }
			];
		}
		if (languageLearning) {
			profileWhere.languagesLearning = { has: languageLearning };
		}
        if (ageRange && ageRange.includes('-')) {
            const [minAgeStr, maxAgeStr] = ageRange.split('-');
            const minAge = parseInt(minAgeStr, 10);
            const maxAge = parseInt(maxAgeStr, 10);
            if (!isNaN(minAge) && !isNaN(maxAge)) {
                const today = new Date();
                const latestBirthDate = new Date(today.getFullYear() - minAge, today.getMonth(), today.getDate());
                const earliestBirthDate = new Date(today.getFullYear() - maxAge - 1, today.getMonth(), today.getDate());
                profileWhere.dateOfBirth = {
                    gte: earliestBirthDate,
                    lte: latestBirthDate,
                };
            }
        }
        if (Object.keys(profileWhere).length > 0) {
            prismaWhere.profile = profileWhere;
        }
        const users = await prisma.user.findMany({
            where: prismaWhere,
            select: {
                id: true,
                nickname: true,
                profile: {
                    select: {
                        profilePicture: true,
                        languagesSpoken: true,
                    }
                }
            },
            take: 50
        });
        res.json(users);
    } catch (error) {
        console.error("Erro ao buscar usuários:", error);
        res.status(500).json({ error: 'Erro interno ao processar a busca.' });
    }
});
app.use('/', authRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/video', videoRoutes);
app.use('/api/connections', connectionsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/dm', dmRoutes);
app.use(learnRoutes);

function isAuthenticated(req, res, next) {
    if (req.isAuthenticated()) { return next(); }
    res.redirect('/login.html');
}
app.get('/chat.html', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'chat.html')); });
app.get('/stop-lobby.html', isAuthenticated, (req, res) => { res.sendFile(path.join(__dirname, 'public', 'stop-lobby.html')); });
app.get('/stop-game.html', isAuthenticated, (req, res) => { res.sendFile(path.join(__dirname, 'public', 'stop-game.html')); });
app.get('/profile.html', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'profile.html')); });
app.get('/admin.html', isAuthenticated, (req, res) => { res.sendFile(path.join(__dirname, 'public', 'admin.html')); });

const wrap = middleware => (socket, next) => middleware(socket.request, {}, next);
io.use(wrap(sessionMiddleware));
io.use(wrap(passport.initialize()));
io.use(wrap(passport.session()));
const { handleStopGameConnection } = require('./sockets/stopGameSocket.js');
const { handleDMEvents } = require('./sockets/dmSocket.js');
const stopNamespace = io.of('/stop');
stopNamespace.use(wrap(sessionMiddleware));
stopNamespace.use(wrap(passport.initialize()));
stopNamespace.use(wrap(passport.session()));
handleStopGameConnection(stopNamespace, prisma, io);

io.on('connection', (socket) => {
    if (socket.request.user) {
        const userId = socket.request.user.id;
        if (!userSocketMap[userId]) {
            userSocketMap[userId] = new Set();
        }
        userSocketMap[userId].add(socket.id);
		console.log(`[Socket.IO] Usuário CONECTADO: ID = ${userId}, Socket ID = ${socket.id}`);
        socket.join(userId);
        console.log(`[Socket.IO] Usuário ${userId} ENTROU na sala: ${userId}`);
        console.log(`[Socket.IO] Usuário ${userId} conectou com socket ${socket.id}. Total de conexões: ${userSocketMap[userId].size}`);
        if (userSocketMap[userId].size === 1) {
            socket.broadcast.emit('user_status_change', { userId, isOnline: true });
        }
        handleDMEvents(socket, io, userSocketMap);
    }

    socket.on('joinRoom', async (data) => {
        try {
            const nickname = socket.request.user ? socket.request.user.nickname : data.nickname;
            const { sala, idade, color } = data;
            if (!nickname || nickname.length > 20 || (!socket.request.user && (!idade || parseInt(idade, 10) < 18))) {
                return socket.emit('invalidData', { message: 'Dados inválidos.' });
            }
            if (!chatRooms[sala]) {
                chatRooms[sala] = { users: {}, history: [] };
            }
            if (Object.keys(chatRooms[sala].users).length >= 20) {
                return socket.emit('roomFull');
            }
            if (Object.values(chatRooms[sala].users).some(u => u.nickname === nickname)) {
                return socket.emit('nicknameTaken', { nickname: nickname });
            }
            socket.join(sala);
            socket.room = sala;
            socket.nickname = nickname;
            let userData;
            if (socket.request.user) {
                const userFromDb = await prisma.user.findUnique({
                    where: { id: socket.request.user.id },
                    include: { profile: true }
                });
                userData = {
                    nickname: userFromDb.nickname,
                    idade: userFromDb.profile.dateOfBirth ? new Date().getFullYear() - new Date(userFromDb.profile.dateOfBirth).getFullYear() : 'N/A', 
                    color: userFromDb.profile.nameColor || '#007aff',
                    status: 'online',
                    isLoggedIn: true,
                    avatar: userFromDb.profile.profilePicture 
                };
            } else {
                userData = { nickname, idade, color, status: 'online', isLoggedIn: false, avatar: null };
            }
            chatRooms[sala].users[socket.id] = userData;
            
            const oneWeekAgo = new Date();
            oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
            const recentHistory = chatRooms[sala].history.filter(msg => new Date(msg.timestamp) > oneWeekAgo);
            chatRooms[sala].history = recentHistory;

            socket.emit('chatHistory', recentHistory);
            io.to(sala).emit('userList', Object.values(chatRooms[sala].users));
        } catch (error) {
            console.error("Erro no evento joinRoom:", error);
            socket.emit('server_error', { message: 'Ocorreu um erro ao entrar na sala.' });
        }
    });

    socket.on('message', async (msg) => {
        if (!socket.room || !socket.nickname) return;
        const room = chatRooms[socket.room];
        const user = room.users[socket.id];
        const userId = socket.request.user?.id || socket.id;
        const now = Date.now();
        const userHistory = messageHistory.get(userId) || [];
        userHistory.push(now);
        const recentMessages = userHistory.filter(timestamp => now - timestamp < SPAM_TIME_WINDOW);
        messageHistory.set(userId, recentMessages);
        if (spamBlockedUsers.has(userId) && now < spamBlockedUsers.get(userId)) {
            socket.emit('spamBlocked', { until: spamBlockedUsers.get(userId) });
            return;
        } else {
            spamBlockedUsers.delete(userId);
        }
        if (recentMessages.length > SPAM_LIMIT) {
            const blockUntil = now + BLOCK_DURATION;
            spamBlockedUsers.set(userId, blockUntil);
            socket.emit('spamBlocked', { until: blockUntil });
            return;
        }
        if (room && user) {
            const messageData = { 
                nickname: socket.nickname, 
                color: user.color, 
                text: msg.text, 
                mentions: msg.mentions, 
                imageData: msg.imageData,
                timestamp: new Date()
            };
            room.history.push(messageData);
            
            io.to(socket.room).emit('message', messageData);
            const tutorMention = msg.mentions.find(mention => mention.toLowerCase() === 'verbi');
            if (tutorMention) {
                const systemPrompt = roomPrompts[socket.room] || "Você é um assistente de IA útil.";
                const userPrompt = msg.text.replace(/@Verbi/gi, '').trim();

                if (userPrompt.length > 0) {
                    try {
                        const HISTORY_LENGTH = 10;
                        const recentHistory = room.history.slice(-HISTORY_LENGTH - 1, -1);
                        
                        const formattedHistory = recentHistory.map(historyMsg => {
                            if (historyMsg.nickname === 'Verbi') {
                                return { role: 'assistant', content: historyMsg.text };
                            } else if (historyMsg.text) { // Garante que mensagens sem texto (ex: só imagem) não entrem
                                return { role: 'user', content: `${historyMsg.nickname}: ${historyMsg.text}` };
                            }
                            return null;
                        }).filter(Boolean);

                        const messagesForApi = [
                            { role: "system", content: systemPrompt },
                            ...formattedHistory,
                            { role: "user", content: `${socket.nickname}: ${userPrompt}` }
                        ];

                        const completion = await openai.chat.completions.create({
                            model: "gpt-4o-mini",
                            messages: messagesForApi,
                        });

                        const text = completion.choices[0].message.content;
                        const tutorResponse = {
                            nickname: 'Verbi',
                            color: '#FF6347',
                            text: text,
                            mentions: [],
                            imageData: null,
                            timestamp: new Date()
                        };
                        room.history.push(tutorResponse);
                        io.to(socket.room).emit('message', tutorResponse);
                    } catch (error) {
                        console.error("Erro ao chamar a API da OpenAI:", error.message);
                        const errorMessage = { nickname: 'Verbi', color: '#FF6347', text: "Desculpe, não consegui processar a sua solicitação. Tente novamente mais tarde.", mentions: [], imageData: null, timestamp: new Date() };
                        io.to(socket.room).emit('message', errorMessage);
                    }
                }
            }
        }
    });

    socket.on('updateStatus', (newStatus) => {
        if (socket.room && chatRooms[socket.room] && chatRooms[socket.room].users[socket.id]) {
            chatRooms[socket.room].users[socket.id].status = newStatus;
            io.to(socket.room).emit('userList', Object.values(chatRooms[socket.room].users));
        }
    });

    // ... (O restante do seu código de videochamada e disconnect permanece o mesmo)
    // =======================================================================
    // == INÍCIO DA SEÇÃO DE VÍDEO COM LOGS DETALHADOS ==
    // =======================================================================

    socket.on('video:invite', async (data) => {
        console.log(`\n--- [VIDEO LOG] INÍCIO DO FLUXO DE CHAMADA ---`);
        const { recipientId } = data;
        const requester = socket.request.user;
        if (!requester) return console.error("[VIDEO LOG] ERRO: Solicitante não autenticado.");

        console.log(`[VIDEO LOG] 'video:invite' recebido de ${requester.nickname} (${requester.id}) para ${recipientId}`);

        try {
            const user = await prisma.user.findUnique({ where: { id: requester.id }, include: { profile: true } });
            if (!user || user.credits < 1) {
                console.log(`[VIDEO LOG] Verificação de créditos FALHOU para ${requester.nickname}. Créditos: ${user?.credits}`);
                return socket.emit('video:error', { message: 'Você não tem créditos suficientes para iniciar uma chamada.' });
            }
            console.log(`[VIDEO LOG] Verificação de créditos OK para ${requester.nickname}.`);

            await prisma.user.update({ where: { id: requester.id }, data: { credits: { decrement: 1 } } });
            console.log(`[VIDEO LOG] 1 crédito debitado de ${requester.nickname}.`);

            const recipientConnections = userSocketMap[recipientId];
            if (recipientConnections && recipientConnections.size > 0) {
                console.log(`[VIDEO LOG] Destinatário ${recipientId} está ONLINE. Preparando convite.`);
                const channel = randomUUID();
                io.to(recipientId).emit('video:incoming_invite', { requester: { id: requester.id, nickname: requester.nickname, profilePicture: user.profile?.profilePicture }, channel: channel });
                console.log(`[VIDEO LOG] Evento 'video:incoming_invite' emitido para a sala do destinatário: ${recipientId}`);
                socket.emit('video:invite_sent', { channel: channel, recipientId: recipientId });
                console.log(`[VIDEO LOG] Evento 'video:invite_sent' emitido de volta para o solicitante: ${requester.nickname}`);
            } else {
                console.log(`[VIDEO LOG] Destinatário ${recipientId} está OFFLINE. Devolvendo crédito.`);
                await prisma.user.update({ where: { id: requester.id }, data: { credits: { increment: 1 } } });
                socket.emit('video:recipient_offline', { message: 'Este usuário não está online. Seu crédito foi devolvido.' });
            }
        } catch (error) {
            console.error("[VIDEO LOG] Erro CRÍTICO em 'video:invite':", error);
            await prisma.user.update({ where: { id: requester.id }, data: { credits: { increment: 1 } } }).catch(e => console.error("[VIDEO LOG] Erro ao devolver crédito após falha:", e));
            socket.emit('video:error', { message: 'Ocorreu um erro interno. Seu crédito foi devolvido.' });
        }
    });

    socket.on('video:accept', (data) => {
        const { requesterId, channel } = data;
        const recipient = socket.request.user;
        if (!recipient) return console.error("[VIDEO LOG] ERRO: Destinatário que aceitou não está autenticado.");

        console.log(`[VIDEO LOG] 'video:accept' recebido de ${recipient.nickname} (${recipient.id}) para a chamada de ${requesterId}`);

        if (userSocketMap[requesterId] && userSocketMap[requesterId].size > 0) {
            console.log(`[VIDEO LOG] Solicitante ${requesterId} ainda está ONLINE. Procedendo com a chamada.`);
            const allParticipants = [requesterId, recipient.id];
       
            io.to(recipient.id).emit('video:invite_accepted', { channel });
            console.log(`[VIDEO LOG] Evento 'video:invite_accepted' emitido para o destinatário: ${recipient.nickname}`);

            const warningTimer = setTimeout(() => {
                console.log(`[VIDEO LOG] Disparando aviso de 10 minutos restantes para o canal ${channel}`);
                allParticipants.forEach(id => { io.to(id).emit('video:warning_10_minutes', { channel }); });
            }, 110 * 60 * 1000);
            
            const endTimer = setTimeout(() => {
                const room = videoCallState[channel];
                if (room) {
                    console.log(`[VIDEO LOG] TEMPO ESGOTADO. Forçando desconexão para o canal ${channel}`);
                    room.originalParticipants.forEach(id => { io.to(id).emit('video:force_disconnect', { channel }); });
                    delete videoCallState[channel];
                }
            }, 120 * 60 * 1000);

            videoCallState[channel] = { participants: new Set(allParticipants), originalParticipants: new Set(allParticipants), warningTimer, endTimer };
            console.log(`[VIDEO LOG] Estado da chamada criado para o canal: ${channel} com participantes: ${allParticipants.join(', ')}`);
            
            io.to(requesterId).emit('video:call_started', { channel, participants: allParticipants });
            io.to(recipient.id).emit('video:call_started', { channel, participants: allParticipants });
            console.log(`[VIDEO LOG] Evento 'video:call_started' emitido para ambos os participantes.`);
            console.log(`--- [VIDEO LOG] FIM DO FLUXO DE ACEITAÇÃO ---`);

        } else {
            console.log(`[VIDEO LOG] AVISO: Solicitante ${requesterId} ficou offline antes da chamada ser aceita.`);
            socket.emit('video:error', { message: 'O usuário que te ligou ficou offline.' });
        }
    });

    socket.on('video:decline', (data) => {
        const { requesterId, channel } = data;
        const recipientNickname = socket.request.user.nickname;
        console.log(`[VIDEO LOG] 'video:decline' recebido de ${recipientNickname} para a chamada de ${requesterId}`);
        io.to(requesterId).emit('video:invite_declined', { message: `${recipientNickname} recusou a chamada.`, channel: channel });
        console.log(`[VIDEO LOG] Evento 'video:invite_declined' emitido para o solicitante ${requesterId}`);
    });

    socket.on('video:leave', (data) => {
        const userId = socket.request.user?.id;
        const { channel } = data;

        if (!userId || !channel || !videoCallState[channel]) return;
        
        console.log(`[VIDEO LOG] 'video:leave' recebido do usuário ${userId} para o canal ${channel}`);
        const room = videoCallState[channel];
        room.participants.delete(userId);
        console.log(`[VIDEO LOG] Participantes restantes no canal ${channel}: ${room.participants.size}`);

        io.to(userId).emit('video:call_ended', { channel });

        if (room.participants.size === 1) {
            const remainingUserId = [...room.participants][0];
            console.log(`[VIDEO LOG] Apenas um usuário restante. Encerrando chamada para ${remainingUserId}`);
            io.to(remainingUserId).emit('video:call_ended', { channel });
        }

        if (room.participants.size < 2) {
            console.log(`[VIDEO LOG] Chamada no canal ${channel} terminada. Limpando timers e estado.`);
            clearTimeout(room.warningTimer);
            clearTimeout(room.endTimer);
            delete videoCallState[channel];
        }
    });
    
    // =======================================================================
    // == FIM DA SEÇÃO DE VÍDEO ==
    // =======================================================================

    socket.on('disconnect', () => {
        if (socket.room && chatRooms[socket.room] && chatRooms[socket.room].users[socket.id]) {
            delete chatRooms[socket.room].users[socket.id];
            const usersInRoom = Object.values(chatRooms[socket.room].users);
            if (usersInRoom.length > 0) {
                io.to(socket.room).emit('userList', usersInRoom);
            } else {
                delete chatRooms[socket.room];
            }
        }
        const userId = socket.request.user?.id;
        if (userId && userSocketMap[userId]) {
            userSocketMap[userId].delete(socket.id);
            console.log(`[Socket.IO] Usuário ${userId} desconectou socket ${socket.id}. Conexões restantes: ${userSocketMap[userId].size}`);
            if (userSocketMap[userId].size === 0) {
                delete userSocketMap[userId];
                console.log(`[Socket.IO] Usuário ${userId} ficou offline.`);
                io.emit('user_status_change', { userId, isOnline: false });
                for (const channel in videoCallState) {
                    const room = videoCallState[channel];
                    if (room.participants.has(userId)) {
                        room.participants.delete(userId);
                        if (room.participants.size > 0) {
                            const remainingUserId = [...room.participants][0];
                            io.to(remainingUserId).emit('video:call_ended', { channel });
                        }
                        clearTimeout(room.warningTimer);
                        clearTimeout(room.endTimer);
                        delete videoCallState[channel];
                    }
                }
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});