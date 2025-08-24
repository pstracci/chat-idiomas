// routes/video.js
const express = require('express');
const router = express.Router();
const { RtcTokenBuilder, RtcRole } = require('agora-token');
const { v4: uuidv4 } = require('uuid');
const { PrismaClient } = require('@prisma/client'); // Importe o PrismaClient
const prisma = new PrismaClient();

function isAuthenticated(req, res, next) {
    if (req.isAuthenticated()) {
        return next();
    }
    res.status(401).json({ error: 'Não autorizado' });
}

function uuidToUint32(uuid) {
    const hex = uuid.replace(/-/g, '').substring(0, 8);
    return parseInt(hex, 16);
}

router.get('/generate-link', isAuthenticated, async (req, res) => {
    try {
        // --- Lógica de Segurança ---
        // 1. Verificar se o usuário tem créditos (exemplo)
        const user = await prisma.user.findUnique({ where: { id: req.user.id } });
        if (user.credits < 1) {
            return res.status(402).json({ error: 'Créditos insuficientes.' });
        }

        // --- Geração das Credenciais da Sala ---
        const appId = process.env.AGORA_APP_ID;
        const appCertificate = process.env.AGORA_APP_CERTIFICATE;
        const channelName = crypto.randomBytes(16).toString('hex'); // Gera um nome de sala aleatório
        const uid = req.user.id; // UID pode ser o ID do usuário
        const role = 1; // 1 para Host, 2 para Audience
        const expirationTimeInSeconds = 3600; // Token válido por 1 hora

        // Gera o token
        const token = RtcTokenBuilder.buildTokenWithUid(appId, appCertificate, channelName, uid, role, expirationTimeInSeconds);
        
        // Pega a URL da aplicação de vídeo das variáveis de ambiente
        const videoAppUrl = process.env.VIDEO_APP_URL;

        // Monta o link final com as credenciais como parâmetros
        const joinUrl = `${videoAppUrl}?channel=${channelName}&token=${token}&uid=${uid}`;

        // Debita o crédito do usuário
        await prisma.user.update({
            where: { id: req.user.id },
            data: { credits: { decrement: 1 } },
        });
        
        // Envia o link completo para o frontend
        res.json({ joinUrl: joinUrl });

    } catch (error) {
        console.error('Erro ao gerar link de vídeo:', error);
        res.status(500).json({ error: 'Erro interno ao criar a sala.' });
    }
});

module.exports = router;