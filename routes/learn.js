// routes/learn.js
const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const fs = require('fs/promises');
const path = require('path');

// Middleware para garantir que o usuário está autenticado.
function isAuthenticated(req, res, next) {
    if (req.isAuthenticated()) {
        return next();
    }
    res.redirect('/login.html');
}

// Função auxiliar para contar os finais de uma história
function countEndingsInStory(storyData) {
    return Object.values(storyData.scenes).filter(scene => scene.isEnding).length;
}

// Rota principal da seção "Aprenda com Histórias"
router.get('/learn', isAuthenticated, async (req, res) => {
    try {
        const storiesDirectory = path.join(__dirname, '..', 'stories');
        const storyFiles = await fs.readdir(storiesDirectory);

        // Busca o progresso do usuário logado
        const userProgressData = await prisma.storyProgress.findMany({
            where: { userId: req.user.id },
            select: { storyId: true, unlockedEndings: true }
        });
        
        // Mapeia o progresso para fácil acesso
        const progressMap = new Map(userProgressData.map(p => [p.storyId, p.unlockedEndings]));

        const storiesWithProgressPromises = storyFiles
            .filter(file => file.endsWith('.json'))
            .map(async file => {
                const filePath = path.join(storiesDirectory, file);
                const fileContent = await fs.readFile(filePath, 'utf-8');
                const storyData = JSON.parse(fileContent);

                const userProgressForStory = progressMap.get(storyData.id) || [];
                const totalEndings = countEndingsInStory(storyData);

                return {
                    id: storyData.id,
                    title: storyData.title,
                    description: storyData.description,
                    imageUrl: storyData.imageUrl,
                    progress: {
                        unlockedCount: userProgressForStory.length,
                        totalEndings: totalEndings
                    }
                };
            });
        
        const storiesWithProgress = await Promise.all(storiesWithProgressPromises);

        res.render('stories', { stories: storiesWithProgress, user: req.user });
    } catch (error) {
        console.error("Erro ao carregar histórias:", error);
        res.status(500).send("Erro ao carregar a página de histórias.");
    }
});

// Rota para a página do jogo de uma história específica
router.get('/learn/story/:storyId', isAuthenticated, (req, res) => {
    const { storyId } = req.params;
    res.render('game', { storyId: storyId, user: req.user });
});

// --- ROTAS DE API ---

// API para buscar o conteúdo JSON de uma história
router.get('/api/stories/:storyId', isAuthenticated, async (req, res) => {
    try {
        const { storyId } = req.params;
        const filePath = path.join(__dirname, '..', 'stories', `${storyId}.json`);
        const fileContent = await fs.readFile(filePath, 'utf-8');
        res.json(JSON.parse(fileContent));
    } catch (error) {
        console.error(`Erro ao ler o arquivo da história ${req.params.storyId}:`, error);
        res.status(404).json({ error: 'História não encontrada.' });
    }
});

// API para marcar uma história como concluída (MODIFICADA para salvar finais)
router.post('/api/stories/complete', isAuthenticated, async (req, res) => {
    try {
        const { storyId, endingId } = req.body;
        if (!storyId || !endingId) {
            return res.status(400).json({ error: 'storyId e endingId são obrigatórios.' });
        }
        
        const userId = req.user.id;
        
        const existingProgress = await prisma.storyProgress.findUnique({
            where: { userId_storyId: { userId, storyId } }
        });

        if (existingProgress) {
            // Se o progresso já existe e o final ainda não foi desbloqueado, adiciona o novo final
            if (!existingProgress.unlockedEndings.includes(endingId)) {
                await prisma.storyProgress.update({
                    where: { id: existingProgress.id },
                    data: { unlockedEndings: { push: endingId } }
                });
            }
        } else {
            // Se não existe progresso, cria um novo registro com o primeiro final
            await prisma.storyProgress.create({
                data: {
                    userId,
                    storyId,
                    unlockedEndings: [endingId]
                }
            });
        }

        res.status(200).json({ success: true, message: 'Progresso salvo com sucesso.' });
    } catch (error) {
        console.error("Erro ao salvar progresso da história:", error);
        res.status(500).json({ error: 'Erro interno ao salvar progresso.' });
    }
});

module.exports = router;