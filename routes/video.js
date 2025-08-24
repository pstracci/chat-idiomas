// routes/video.js
const express = require('express');
const { RtcTokenBuilder, RtcRole } = require('agora-token');

const router = express.Router();

// Função para converter UUID para um inteiro de 32 bits
// (Copiado de agora.js para consistência)
function uuidToUint32(uuid) {
    const hex = uuid.replace(/-/g, '').substring(0, 8);
    return parseInt(hex, 16);
}

// Middleware de autenticação
function isAuthenticated(req, res, next) {
    if (req.isAuthenticated()) {
        return next();
    }
    res.status(401).json({ error: 'Não autorizado' });
}

// Função para gerar o token do Agora (CORRIGIDA E MELHORADA)
const generateAgoraToken = (req, res) => {
    const expirationTimeInSeconds = 3600; // 1 hora
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const privilegeExpiredTs = currentTimestamp + expirationTimeInSeconds;

    const APP_ID = process.env.AGORA_APP_ID;
    const APP_CERTIFICATE = process.env.AGORA_APP_CERTIFICATE;

    if (!APP_ID || !APP_CERTIFICATE) {
        return res.status(500).json({ error: 'Credenciais do Agora não configuradas no servidor.' });
    }

    const channelName = req.body.channel;
    if (!channelName) {
        return res.status(400).json({ error: 'O nome do canal (channelName) é obrigatório.' });
    }
    
    // --- ALTERAÇÃO PRINCIPAL: Usar um UID específico do usuário ---
    // O usuário agora está autenticado, então podemos usar o ID dele.
    const uid = uuidToUint32(req.user.id); 
    const role = RtcRole.PUBLISHER;

    const token = RtcTokenBuilder.buildTokenWithUid(APP_ID, APP_CERTIFICATE, channelName, uid, role, privilegeExpiredTs);

    res.json({
        appId: APP_ID,
        channel: channelName,
        token: token,
        uid: uid // Retorna o UID para o cliente usar
    });
};

// Adiciona o middleware isAuthenticated à rota
router.post('/generate-token', isAuthenticated, generateAgoraToken);

module.exports = router;