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

// Endpoint modificado para verificar e descontar créditos
router.get('/generate-link', isAuthenticated, async (req, res) => {
    try {
        // 1. Busca o utilizador e o seu saldo de créditos
        const user = await prisma.user.findUnique({
            where: { id: req.user.id }
        });

        // 2. Verifica se o utilizador tem créditos suficientes
        if (user.credits < 1) {
            // HTTP Status 402 significa "Pagamento Necessário"
            return res.status(402).json({ error: 'Créditos insuficientes para criar uma sala. Por favor, adquira mais créditos.' });
        }

        // 3. Desconta 1 crédito e gera o link (dentro de uma transação)
        // A transação garante que o crédito só é descontado se tudo o resto funcionar
        await prisma.$transaction(async (tx) => {
            // Desconta o crédito
            await tx.user.update({
                where: { id: req.user.id },
                data: { credits: { decrement: 1 } }
            });

            // Lógica para gerar o link (como antes)
            const channelName = uuidv4();
            const uid = uuidToUint32(req.user.id);
            const userDisplayName = req.user.nickname;
            const expirationTimeInSeconds = 3600;
            const currentTimestamp = Math.floor(Date.now() / 1000);
            const privilegeExpiredTs = currentTimestamp + expirationTimeInSeconds;
            const appId = process.env.AGORA_APP_ID;
            const appCertificate = process.env.AGORA_APP_CERTIFICATE;

            const rtcToken = RtcTokenBuilder.buildTokenWithUid(appId, appCertificate, channelName, uid, RtcRole.PUBLISHER, privilegeExpiredTs);
            
            const videoAppUrl = "https://verbi-video-app-production.up.railway.app/"; 
            const joinUrl = `${videoAppUrl}?channel=${encodeURIComponent(channelName)}&token=${encodeURIComponent(rtcToken)}&user=${encodeURIComponent(userDisplayName)}`;

            // Envia o URL de volta para o frontend
            res.json({ joinUrl: joinUrl });
        });

    } catch (error) {
        console.error("Erro ao gerar link de vídeo:", error);
        res.status(500).json({ error: "Ocorreu um erro ao tentar criar a sala de vídeo." });
    }
});

module.exports = router;