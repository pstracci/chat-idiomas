// routes/admin.js
const express = require('express');
const router = express.Router();
const { PrismaClient, Role } = require('@prisma/client'); // Importa o Enum 'Role'
const prisma = new PrismaClient();

// Middleware para garantir que o utilizador está autenticado
function isAuthenticated(req, res, next) {
    if (req.isAuthenticated()) {
        return next();
    }
    res.status(401).json({ error: 'Não autorizado' });
}

// Middleware "Porteiro" para garantir que o utilizador é um Administrador
function isAdmin(req, res, next) {
    if (req.user && req.user.role === Role.ADMIN) {
        return next();
    }
    res.status(403).json({ error: 'Acesso negado. Recurso apenas para administradores.' });
}

// Aplica a verificação de autenticação e de admin a TODAS as rotas neste ficheiro
router.use(isAuthenticated, isAdmin);

// --- ROTAS DE ADMINISTRAÇÃO ---

// Rota para buscar todos os utilizadores
router.get('/users', async (req, res) => {
    try {
        const users = await prisma.user.findMany({
            orderBy: { createdAt: 'desc' },
            include: {
                profile: true, // Inclui os dados do perfil de cada utilizador
            },
        });
        res.json(users);
    } catch (error) {
        console.error("Erro ao buscar utilizadores:", error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// Rota para apagar um utilizador
router.delete('/users/:userId', async (req, res) => {
    const { userId } = req.params;
    try {
        // Garante que um admin não se apague a si mesmo
        if (req.user.id === userId) {
            return res.status(400).json({ error: 'Um administrador não se pode apagar a si mesmo.' });
        }
        await prisma.user.delete({ where: { id: userId } });
        res.status(204).send(); // Sucesso, sem conteúdo
    } catch (error) {
        console.error(`Erro ao apagar utilizador ${userId}:`, error);
        res.status(500).json({ error: 'Erro ao apagar utilizador.' });
    }
});

// Rota para atualizar os créditos de um utilizador
router.put('/users/:userId/credits', async (req, res) => {
    const { userId } = req.params;
    const { credits } = req.body;

    // Validação
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

// Rota para enviar uma notificação global para todos os utilizadores
router.post('/notifications', async (req, res) => {
    const { message } = req.body;

    if (!message || typeof message !== 'string' || message.trim() === '') {
        return res.status(400).json({ error: 'A mensagem da notificação não pode estar vazia.' });
    }

    try {
        // 1. Busca o ID de todos os utilizadores (exceto o próprio admin)
        const users = await prisma.user.findMany({
            where: { id: { not: req.user.id } },
            select: { id: true },
        });

        // 2. Prepara os dados da notificação para cada utilizador
        const notificationsData = users.map(user => ({
            userId: user.id,
            type: 'SYSTEM_MESSAGE',
            content: message.trim(),
            relatedId: req.user.id, // Guarda o ID do admin que enviou
        }));

        // 3. Insere todas as notificações no banco de dados de uma só vez (eficiente)
        await prisma.notification.createMany({
            data: notificationsData,
        });

        res.status(201).json({ success: true, message: `Notificação enviada para ${users.length} utilizadores.` });
    } catch (error) {
        console.error("Erro ao enviar notificação global:", error);
        res.status(500).json({ error: 'Erro ao enviar notificação.' });
    }
});

module.exports = router;