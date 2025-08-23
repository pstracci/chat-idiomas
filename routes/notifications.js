// routes/notifications.js
const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

function isAuthenticated(req, res, next) {
    if (req.isAuthenticated()) { return next(); }
    res.status(401).json({ error: 'Não autorizado' });
}

// Rota UNIFICADA para buscar todas as notificações não lidas
router.get('/', isAuthenticated, async (req, res) => {
    try {
        const notifications = await prisma.notification.findMany({
            where: {
                userId: req.user.id,
                read: false
            },
            orderBy: {
                createdAt: 'desc'
            }
        });

        // Extrai os IDs das conexões das notificações do tipo 'CONNECTION_REQUEST'
        const connectionRequestIds = notifications
            .filter(n => n.type === 'CONNECTION_REQUEST' && n.relatedId)
            .map(n => n.relatedId);

        let connections = {};
        if (connectionRequestIds.length > 0) {
            // Busca as informações das conexões e dos solicitantes
            const connectionData = await prisma.connection.findMany({
                where: {
                    id: { in: connectionRequestIds }
                },
                include: {
                    requester: {
                        select: {
                            id: true,
                            nickname: true,
                            profile: {
                                select: {
                                    profilePicture: true
                                }
                            }
                        }
                    }
                }
            });
            // Transforma o array em um mapa para acesso rápido
            connections = connectionData.reduce((acc, conn) => {
                acc[conn.id] = conn;
                return acc;
            }, {});
        }

        // Enriquece as notificações com os dados do solicitante, se aplicável
        const enrichedNotifications = notifications.map(notification => {
            if (notification.type === 'CONNECTION_REQUEST' && connections[notification.relatedId]) {
                const requester = connections[notification.relatedId].requester;
                // Anexa a informação do solicitante à notificação
                return {
                    ...notification,
                    requester: {
                        id: requester.id,
                        nickname: requester.nickname,
                        profilePicture: requester.profile?.profilePicture
                    }
                };
            }
            return notification;
        });

        res.json(enrichedNotifications);

    } catch (error) {
        console.error("Erro ao buscar notificações:", error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// Rota para marcar uma notificação como lida
router.put('/:notificationId/read', isAuthenticated, async (req, res) => {
    const { notificationId } = req.params;
    try {
        const notification = await prisma.notification.findUnique({
            where: { id: notificationId }
        });

        // Garante que um utilizador só pode marcar as suas próprias notificações
        if (!notification || notification.userId !== req.user.id) {
            return res.status(403).json({ error: 'Não autorizado' });
        }

        await prisma.notification.update({
            where: { id: notificationId },
            data: { read: true }
        });

        res.status(204).send(); // Sucesso, sem conteúdo
    } catch (error) {
        console.error("Erro ao marcar notificação como lida:", error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

module.exports = router;