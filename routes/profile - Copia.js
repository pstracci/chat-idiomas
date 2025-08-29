// routes/profile.js
const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Middleware para garantir que o utilizador está autenticado (usado apenas para rotas que precisam)
function isAuthenticated(req, res, next) {
    if (req.isAuthenticated()) {
        return next();
    }
    res.status(401).json({ error: 'Não autorizado' });
	
}


// Rota para buscar o perfil do próprio utilizador logado
// NENHUMA ALTERAÇÃO NECESSÁRIA AQUI - JÁ BUSCA OS NOVOS CAMPOS AUTOMATICAMENTE
router.get('/me', isAuthenticated, async (req, res) => {
    try {
        const profile = await prisma.profile.findUnique({
            where: { userId: req.user.id },
            include: { user: { select: { email: true, nickname: true } } },
        });

        if (!profile) {
            const newProfile = await prisma.profile.create({
                data: { 
                    userId: req.user.id,
                },
                include: { user: { select: { email: true, nickname: true } } },
            });
            return res.json(newProfile);
        }

        res.json(profile);
    } catch (error) {
        console.error("Erro ao buscar perfil:", error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// Rota para atualizar o perfil do utilizador logado
// --- ALTERAÇÕES REALIZADAS AQUI ---
router.put('/me', isAuthenticated, async (req, res) => {
    // 1. Desestrutura todos os campos que vêm do frontend
    const {
        nickname,
        firstName,
        lastName,
        dateOfBirth,
        country,
        profilePicture,
        languagesSpoken,
        languagesLearning,
        aboutMe,
        perfectPartner,
        learningReason
    } = req.body;

    try {
        // 2. Inicia uma transação para atualizar ambas as tabelas
        const [, updatedProfile] = await prisma.$transaction([
            
            // ATUALIZAÇÃO 1: Apenas o 'nickname' na tabela 'User'
            prisma.user.update({
                where: { id: req.user.id },
                data: {
                    nickname: nickname // <-- SOMENTE o que pertence ao User vai aqui
                },
            }),

            // ATUALIZAÇÃO 2: Todo o resto na tabela 'Profile'
            prisma.profile.update({
                where: { userId: req.user.id },
                data: {
                    // <-- Todos os outros campos do formulário vão aqui
                    firstName,
                    lastName,
                    dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
                    country,
                    profilePicture,
                    languagesSpoken,
                    languagesLearning,
                    aboutMe,
                    perfectPartner,
                    learningReason
                },
            })
        ]);
        
        // 3. Retorna o perfil atualizado com sucesso
        res.json(updatedProfile);

    } catch (error) {
        console.error("Erro ao atualizar perfil:", error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// --- ROTA MODIFICADA: Busca de utilizadores agora é pública ---
router.get('/search', async (req, res) => {
    const query = req.query.q;
    if (!query) {
        return res.json([]);
    }
    try {
        const users = await prisma.user.findMany({
            where: {
                // Remove a condição que excluía o próprio utilizador, pois pode não haver um.
                OR: [
                    { nickname: { contains: query, mode: 'insensitive' } },
                    { profile: { firstName: { contains: query, mode: 'insensitive' } } },
                    { profile: { lastName: { contains: query, mode: 'insensitive' } } },
                ]
            },
            take: 5,
            select: {
                id: true,
                nickname: true,
                profile: {
                    select: { profilePicture: true },
                },
            },
        });
        res.json(users);
    } catch (error) {
        console.error("Erro na busca de utilizadores:", error);
        res.status(500).json({ error: 'Erro ao buscar utilizadores' });
    }
});


// Rota para buscar o perfil de um utilizador específico (público)
// NENHUMA ALTERAÇÃO NECESSÁRIA AQUI - JÁ BUSCA OS NOVOS CAMPOS AUTOMATICAMENTE
router.get('/:userId', async (req, res) => {
    try {
        const loggedInUser = req.user; // Pode ser undefined se não estiver logado
        const profileUserId = req.params.userId;

        const profile = await prisma.profile.findUnique({
            where: { userId: profileUserId },
            include: {
                user: {
                    select: { id: true, nickname: true, isOnline: true, lastSeen: true },
                },
            },
        });

        if (!profile) {
            return res.status(404).json({ error: 'Perfil não encontrado' });
        }

        let connectionStatus = null;
        let connectionId = null;

        // Só verifica a conexão se houver um utilizador logado
        if (loggedInUser && loggedInUser.id !== profileUserId) {
            const connection = await prisma.connection.findFirst({
                where: {
                    OR: [
                        { requesterId: loggedInUser.id, addresseeId: profileUserId },
                        { requesterId: profileUserId, addresseeId: loggedInUser.id },
                    ],
                },
            });
            if (connection) {
                connectionId = connection.id;
                if (connection.status === 'PENDING' && connection.requesterId === loggedInUser.id) {
                    connectionStatus = 'PENDING_SENT';
                } else if (connection.status === 'PENDING' && connection.addresseeId === loggedInUser.id) {
                    connectionStatus = 'PENDING_RECEIVED';
                } else {
                    connectionStatus = connection.status;
                }
            }
        }
        
        profile.connectionStatus = connectionStatus;
        profile.connectionId = connectionId;

        res.json(profile);

    } catch (error) {
        console.error("Erro ao buscar perfil público:", error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

module.exports = router;