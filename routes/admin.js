// routes/admin.js (Versão Completa e Corrigida)
const express = require('express');
const router = express.Router();
const { PrismaClient, Role } = require('@prisma/client');
const prisma = new PrismaClient();
const crypto = require('crypto');
const sgMail = require('@sendgrid/mail');

module.exports = function(io) {

    function isAuthenticated(req, res, next) {
        if (req.isAuthenticated()) { return next(); }
        res.status(401).json({ error: 'Não autorizado' });
    }

    function isAdmin(req, res, next) {
        if (req.user && req.user.role === Role.ADMIN) { return next(); }
        res.status(403).json({ error: 'Acesso negado. Recurso apenas para administradores.' });
    }

    router.use(isAuthenticated, isAdmin);

    sgMail.setApiKey(process.env.SENDGRID_API_KEY);

    async function resendAdminVerificationEmail(user, req) {
        const token = crypto.randomBytes(32).toString('hex');
        const expires = new Date(Date.now() + 3600000 * 24);
        await prisma.user.update({
            where: { id: user.id },
            data: { emailConfirmationToken: token, emailConfirmationTokenExpires: expires },
        });
        const verificationURL = `${req.protocol}://${req.get('host')}/verify-email?token=${token}`;
        const msg = {
            to: user.email,
            from: { name: 'Verbi', email: process.env.SENDER_EMAIL },
            subject: 'Confirme seu E-mail no Verbi',
            html: `<p>Olá ${user.profile.firstName},</p><p>Um administrador solicitou o reenvio do e-mail de ativação para a sua conta no Verbi. Por favor, clique no link abaixo para ativar sua conta:</p><a href="${verificationURL}">${verificationURL}</a><p>Este link expirará em 24 horas.</p>`
        };
        try {
            await sgMail.send(msg);
        } catch (error) {
            console.error('Erro ao reenviar e-mail de verificação (admin) pelo SendGrid:', error);
            if (error.response) { console.error(error.response.body); }
            throw new Error('Falha ao reenviar e-mail de verificação.');
        }
    }

    router.get('/users', async (req, res) => {
        try {
            const users = await prisma.user.findMany({
                orderBy: { createdAt: 'desc' },
                select: { id: true, nickname: true, email: true, credits: true, isVerified: true, createdAt: true }
            });
            res.json(users);
        } catch (error) {
            console.error("Erro ao buscar utilizadores:", error);
            res.status(500).json({ error: 'Erro interno do servidor' });
        }
    });

    router.delete('/users/:userId', async (req, res) => {
        const { userId } = req.params;
        try {
            if (req.user.id === userId) {
                return res.status(400).json({ error: 'Um administrador não se pode apagar a si mesmo.' });
            }
            await prisma.user.delete({ where: { id: userId } });
            res.status(204).send();
        } catch (error) {
            console.error(`Erro ao apagar utilizador ${userId}:`, error);
            res.status(500).json({ error: 'Erro ao apagar utilizador.' });
        }
    });

    router.put('/users/:userId/credits', async (req, res) => {
        const { userId } = req.params;
        const { credits } = req.body;
        if (typeof credits !== 'number' || credits < 0) {
            return res.status(400).json({ error: 'A quantidade de créditos deve ser um número positivo.' });
        }
        try {
            const updatedUser = await prisma.user.update({
                where: { id: userId },
                data: { credits: credits },
            });
            res.json({ id: updatedUser.id, credits: updatedUser.credits });
        } catch (error) {
            console.error(`Erro ao atualizar créditos do utilizador ${userId}:`, error);
            res.status(500).json({ error: 'Erro ao atualizar créditos.' });
        }
    });

    router.post('/users/:userId/resend-verification', async (req, res) => {
        const { userId } = req.params;
        try {
            const user = await prisma.user.findUnique({
                where: { id: userId },
                include: { profile: true }
            });
            if (!user) { return res.status(404).json({ error: 'Usuário não encontrado.' }); }
            if (user.isVerified) { return res.status(400).json({ error: 'Este usuário já verificou o e-mail.' }); }
            await resendAdminVerificationEmail(user, req);
            res.status(200).json({ success: true, message: `E-mail de verificação reenviado para ${user.email}.` });
        } catch (error) {
            console.error(`Erro ao reenviar e-mail de verificação para ${userId}:`, error);
            res.status(500).json({ error: 'Erro no servidor ao reenviar e-mail.' });
        }
    });

    // ROTA DE NOTIFICAÇÃO GLOBAL
    router.post('/notifications', async (req, res) => {
        const { message } = req.body;
        if (!message || typeof message !== 'string' || message.trim() === '') {
            return res.status(400).json({ error: 'A mensagem da notificação não pode estar vazia.' });
        }
        try {
            const users = await prisma.user.findMany({
                where: { id: { not: req.user.id } },
                select: { id: true },
            });

            // --- CORREÇÃO APLICADA AQUI ---
            // Removido o campo 'relatedId' que causava o erro.
            const notificationsData = users.map(user => ({
                userId: user.id,
                type: 'SYSTEM_MESSAGE',
                content: message.trim(),
            }));

            await prisma.notification.createMany({ data: notificationsData });
            users.forEach(user => { io.to(user.id).emit('new_notification'); });
            res.status(201).json({ success: true, message: `Notificação enviada para ${users.length} utilizadores.` });
        } catch (error) {
            console.error("Erro ao enviar notificação global:", error);
            res.status(500).json({ error: 'Erro ao enviar notificação.' });
        }
    });

    // ROTA DE NOTIFICAÇÃO PARA USUÁRIO ESPECÍFICO
    router.post('/notifications/user/:userId', async (req, res) => {
        const { userId } = req.params;
        const { message } = req.body;
        if (!message || typeof message !== 'string' || message.trim() === '') {
            return res.status(400).json({ error: 'A mensagem não pode estar vazia.' });
        }
        try {
            const user = await prisma.user.findUnique({ where: { id: userId } });
            if (!user) { return res.status(404).json({ error: 'Usuário não encontrado.' }); }

            await prisma.notification.create({
                data: {
                    userId: userId,
                    type: 'SYSTEM_MESSAGE',
                    content: message.trim(),
                    // --- CORREÇÃO APLICADA AQUI ---
                    // Linha 'relatedId' foi removida para não violar a regra do banco de dados.
                }
            });

            console.log(`[Socket.IO] Tentando emitir 'new_notification' para a sala: ${userId}`);
            io.to(userId).emit('new_notification');
            res.status(201).json({ success: true, message: `Notificação enviada para ${user.nickname}.` });
        } catch (error) {
            console.error(`Erro ao enviar notificação para ${userId}:`, error);
            res.status(500).json({ error: 'Erro ao enviar notificação.' });
        }
    });

    return router;
};