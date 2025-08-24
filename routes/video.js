// routes/video.js
const express = require('express');
const { RtcTokenBuilder, RtcRole } = require('agora-token');

const router = express.Router();

// Função para gerar o token do Agora
const generateAgoraToken = (req, res) => {
    // Defina o tempo de expiração do token (ex: 1 hora)
    const expirationTimeInSeconds = 3600;
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const privilegeExpiredTs = currentTimestamp + expirationTimeInSeconds;

    // Pegue suas credenciais das variáveis de ambiente
    const APP_ID = process.env.AGORA_APP_ID;
    const APP_CERTIFICATE = process.env.AGORA_APP_CERTIFICATE;

    if (!APP_ID || !APP_CERTIFICATE) {
        return res.status(500).json({ error: 'Credenciais do Agora não configuradas no servidor.' });
    }

    const channelName = req.body.channel || Math.random().toString(36).substring(7);
    
    // O UID pode ser 0 para permitir que qualquer usuário entre
    const uid = 0; 
    const role = RtcRole.PUBLISHER;

    // Construa o token
    const token = RtcTokenBuilder.buildTokenWithUid(APP_ID, APP_CERTIFICATE, channelName, uid, role, privilegeExpiredTs);

    // Envie as informações de volta para o front-end
    res.json({
        appId: APP_ID,
        channel: channelName,
        token: token
    });
};

// Defina a rota que o front-end está chamando
// É importante que seja .post() porque a requisição é do tipo POST
router.post('/generate-token', generateAgoraToken);

module.exports = router;