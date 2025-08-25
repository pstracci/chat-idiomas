// routes/dm.js
const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

function isAuthenticated(req, res, next) {
    if (req.isAuthenticated()) {
        return next();
    }
    res.status(401).json({ error: 'Não autorizado' });
}

router.use(isAuthenticated);

router.get('/history/:recipientId', async (req, res) => {
    try {
        const userId1 = req.user.id;
        const userId2 = req.params.recipientId;

        const conversation = await prisma.conversation.findFirst({
            where: {
                AND: [
                    { participants: { some: { id: userId1 } } },
                    { participants: { some: { id: userId2 } } }
                ]
            },
            include: {
                messages: {
                    orderBy: {
                        createdAt: 'asc'
                    }
                }
            }
        });

        res.json(conversation ? conversation.messages : []);
    } catch (error) {
        console.error("Erro ao buscar histórico de DM:", error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// --- NOVA ROTA PARA MARCAR MENSAGENS COMO LIDAS ---
router.put('/conversations/read/:senderId', async (req, res) => {
    try {
        const receiverId = req.user.id;
        const senderId = req.params.senderId;

        const conversation = await prisma.conversation.findFirst({
            where: {
                AND: [
                    { participants: { some: { id: receiverId } } },
                    { participants: { some: { id: senderId } } }
                ]
            }
        });

        if (conversation) {
            // Marca como lidas todas as mensagens da conversa que foram enviadas pelo outro usuário
            await prisma.message.updateMany({
                where: {
                    conversationId: conversation.id,
                    senderId: senderId,
                    read: false
                },
                data: {
                    read: true
                }
            });
        }
        
        res.status(204).send(); // Sucesso, sem conteúdo
    } catch (error) {
        console.error("Erro ao marcar DMs como lidas:", error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});


module.exports = router;