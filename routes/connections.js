// routes/connections.js
const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// A estrutura inteira do arquivo deve estar dentro desta função.
// A primeira linha do seu arquivo DEVE ser esta:
module.exports = function(io) {

    function isAuthenticated(req, res, next) {
        if (req.isAuthenticated()) {
            return next();
        }
        res.status(401).json({ error: 'Não autorizado' });
    }

    // Rota para buscar todas as conexões ACEITES
    router.get('/', isAuthenticated, async (req, res) => {
        try {
            const connections = await prisma.connection.findMany({
                where: {
                    OR: [
                        { requesterId: req.user.id },
                        { addresseeId: req.user.id }
                    ],
                    status: 'ACCEPTED'
                },
                include: {
                    requester: { include: { profile: true } },
                    addressee: { include: { profile: true } }
                }
            });

            const friends = connections.map(conn => {
                const friend = conn.requesterId === req.user.id ? conn.addressee : conn.requester;
                return {
                    connectionId: conn.id,
                    friendInfo: {
                        id: friend.id,
                        nickname: friend.nickname,
                        profilePicture: friend.profile.profilePicture
                    }
                };
            });

            res.json(friends);
        } catch (error) {
            console.error("Erro ao buscar conexões:", error);
            res.status(500).json({ error: 'Erro interno do servidor' });
        }
    });

    // Rota para enviar pedido de conexão
    router.post('/request/:addresseeId', isAuthenticated, async (req, res) => {
        const requesterId = req.user.id;
        const { addresseeId } = req.params;

        if (requesterId === addresseeId) {
            return res.status(400).json({ error: 'Você não pode se conectar a si mesmo.' });
        }

        try {
            const existingConnection = await prisma.connection.findFirst({
                where: { OR: [ { requesterId, addresseeId }, { requesterId: addresseeId, addresseeId: requesterId } ] }
            });
            if (existingConnection) {
                return res.status(409).json({ error: 'Já existe um pedido de conexão ou uma conexão com este utilizador.' });
            }

            const newConnection = await prisma.$transaction(async (tx) => {
                const connection = await tx.connection.create({
                    data: { requesterId, addresseeId, status: 'PENDING' }
                });
                await tx.notification.create({
                    data: {
                        userId: addresseeId,
                        type: 'CONNECTION_REQUEST',
                        content: `${req.user.nickname} quer se conectar com você.`,
                        relatedId: connection.id
                    }
                });

                // Emite o evento em tempo real para o destinatário
                io.to(addresseeId).emit('new_notification');
                
                return connection;
            });

            res.status(201).json(newConnection);
        } catch (error) {
            console.error("Erro ao enviar pedido:", error);
            res.status(500).json({ error: 'Erro ao enviar pedido de conexão.' });
        }
    });

    // Rota para aceitar pedido
    router.put('/accept/:connectionId', isAuthenticated, async (req, res) => {
        const { connectionId } = req.params;
        try {
            const request = await prisma.connection.findUnique({ where: { id: connectionId } });
            if (!request || request.addresseeId !== req.user.id) {
                return res.status(403).json({ error: 'Não autorizado a aceitar este pedido.' });
            }

            await prisma.$transaction(async (tx) => {
                await tx.connection.update({
                    where: { id: connectionId },
                    data: { status: 'ACCEPTED' }
                });
                await tx.notification.updateMany({
                    where: { relatedId: connectionId, type: 'CONNECTION_REQUEST' },
                    data: { read: true }
                });
            });
            
            res.status(200).json({ message: 'Conexão aceite.' });
        } catch (error) {
            console.error("Erro ao aceitar pedido:", error);
            res.status(500).json({ error: 'Erro ao aceitar pedido.' });
        }
    });

    // Rota para rejeitar/deletar pedido
    router.delete('/delete/:connectionId', isAuthenticated, async (req, res) => {
        const { connectionId } = req.params;
        try {
            const connection = await prisma.connection.findUnique({ where: { id: connectionId } });
            if (!connection || (connection.requesterId !== req.user.id && connection.addresseeId !== req.user.id)) {
                return res.status(403).json({ error: 'Não autorizado a remover esta conexão.' });
            }
            
            await prisma.$transaction(async (tx) => {
                await tx.notification.deleteMany({
                    where: { relatedId: connectionId }
                });
                await tx.connection.delete({ where: { id: connectionId } });
            });

            res.status(204).send();
        } catch (error) {
            console.error("Erro ao remover conexão:", error);
            res.status(500).json({ error: 'Erro ao remover conexão.' });
        }
    });
    
    // =======================================================================
    // == PONTO CRÍTICO DA CORREÇÃO ==
    // Esta linha ABAIXO é a que resolve o problema.
    // Ela DEVE estar aqui, ANTES do '};' final.
    return router;
    // =======================================================================

}; // A última linha do seu arquivo DEVE ser esta.