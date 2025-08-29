// routes/dm.js
const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

module.exports = function(userSocketMap) {

    function isAuthenticated(req, res, next) {
        if (req.isAuthenticated()) {
            return next();
        }
        res.status(401).json({ error: 'Não autorizado' });
    }
    router.use(isAuthenticated);

    /**
     * ROTA: GET /api/dm/conversations
     */
    router.get('/conversations', async (req, res) => {
        const loggedInUserId = req.user.id;
        try {
            const conversations = await prisma.conversation.findMany({
                // ================== CORREÇÃO AQUI ==================
                where: { participants: { some: { B: loggedInUserId } } }, // Trocado 'id' por 'B'
                // ===================================================
                include: {
                    participants: {
                        // ================== CORREÇÃO AQUI ==================
                        where: { B: { not: loggedInUserId } }, // Trocado 'id' por 'B'
                        // ===================================================
                        include: { 
                            User: { // Inclui o usuário através da relação para pegar os dados
                                select: { 
                                    id: true, 
                                    nickname: true, 
                                    profile: { select: { profilePicture: true } } 
                                }
                            }
                        }
                    },
                    messages: {
                        orderBy: { createdAt: 'desc' },
                        take: 1
                    }
                }
            });

            const formattedConversations = conversations.map(conv => {
                if (conv.participants.length === 0 || conv.messages.length === 0 || !conv.participants[0].User) {
                    return null;
                }
                return {
                    participant: conv.participants[0].User, // Acessa os dados do usuário corretamente
                    lastMessage: {
                        text: conv.messages[0].text || 'Imagem',
                        timestamp: conv.messages[0].createdAt,
                        read: conv.messages[0].read,
                        senderId: conv.messages[0].senderId
                    }
                };
            }).filter(Boolean);

            formattedConversations.sort((a, b) => new Date(b.lastMessage.timestamp) - new Date(a.lastMessage.timestamp));

            res.json(formattedConversations);
        } catch (error) {
            console.error("Erro ao buscar conversas:", error);
            res.status(500).json({ error: 'Erro interno do servidor' });
        }
    });

    /**
     * ROTA: GET /api/dm/history/:recipientId
     */
    router.get('/history/:recipientId', async (req, res) => {
        try {
            const userId1 = req.user.id;
            const userId2 = req.params.recipientId;

            const recipient = await prisma.user.findUnique({
                where: { id: userId2 },
                select: {
                    id: true,
                    nickname: true,
                    profile: { select: { profilePicture: true } }
                }
            });

            if (!recipient) {
                return res.status(404).json({ error: 'Usuário não encontrado' });
            }
            
            const isOnline = userSocketMap[userId2] && userSocketMap[userId2].size > 0;

            const conversation = await prisma.conversation.findFirst({
                // ================== CORREÇÃO AQUI ==================
                where: { 
                    AND: [
                        { participants: { some: { B: userId1 } } }, // Trocado 'id' por 'B'
                        { participants: { some: { B: userId2 } } }  // Trocado 'id' por 'B'
                    ] 
                },
                // ===================================================
                include: {
                    messages: {
                        orderBy: { createdAt: 'asc' },
                        include: { sender: { select: { id: true } } } 
                    }
                }
            });

            res.json({
                messages: conversation ? conversation.messages : [],
                participant: {
                    ...recipient,
                    isOnline: isOnline
                }
            });
        } catch (error) {
            console.error("Erro ao buscar histórico de DM:", error);
            res.status(500).json({ error: 'Erro interno do servidor' });
        }
    });

    /**
     * ROTA: PUT /api/dm/conversations/read/:senderId
     */
    router.put('/conversations/read/:senderId', async (req, res) => {
        try {
            const receiverId = req.user.id;
            const senderId = req.params.senderId;

            const conversation = await prisma.conversation.findFirst({
                // ================== CORREÇÃO AQUI ==================
                where: { 
                    AND: [
                        { participants: { some: { B: receiverId } } }, // Trocado 'id' por 'B'
                        { participants: { some: { B: senderId } } }      // Trocado 'id' por 'B'
                    ]
                }
                // ===================================================
            });

            if (conversation) {
                await prisma.message.updateMany({
                    where: {
                        conversationId: conversation.id,
                        senderId: senderId,
                        read: false
                    },
                    data: { read: true }
                });
            }
            res.status(204).send();
        } catch (error) {
            console.error("Erro ao marcar DMs como lidas:", error);
            res.status(500).json({ error: 'Erro interno do servidor' });
        }
    });

    return router;
};