// routes/agora.js
const express = require('express');
const router = express.Router();
const { RtcTokenBuilder, RtcRole, RtmTokenBuilder } = require('agora-token');

function isAuthenticated(req, res, next) {
    if (req.isAuthenticated()) {
        return next();
    }
    res.status(401).json({ error: 'Não autorizado' });
}

// Função para converter UUID em número (mantida para o RTC)
function uuidToUint32(uuid) {
    const hex = uuid.replace(/-/g, '').substring(0, 8);
    return parseInt(hex, 16);
}

router.get('/token', isAuthenticated, (req, res) => {
    const channelName = req.query.channelName;
    if (!channelName) {
        return res.status(400).json({ error: 'O nome do canal (channelName) é obrigatório.' });
    }

    const userAccount = req.user.id; // UID como string (UUID original) para o RTM
    const uid_rtc = uuidToUint32(userAccount); // UID como número para o RTC
    
    const role = RtcRole.PUBLISHER;
    const expirationTimeInSeconds = 3600; // 1 hora
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const privilegeExpiredTs = currentTimestamp + expirationTimeInSeconds;

    const appId = process.env.AGORA_APP_ID;
    const appCertificate = process.env.AGORA_APP_CERTIFICATE;

    if (!appId || !appCertificate) {
        console.error("ERRO: Credenciais da Agora (AGORA_APP_ID ou AGORA_APP_CERTIFICATE) não estão definidas no ficheiro .env");
        return res.status(500).json({ error: 'Configuração do servidor para videochamada está incompleta.' });
    }

    // 1. Gera o token para a chamada de vídeo (RTC) usando o UID NUMÉRICO
    const rtcToken = RtcTokenBuilder.buildTokenWithUid(appId, appCertificate, channelName, uid_rtc, role, privilegeExpiredTs);

    // 2. Gera o token específico para o chat (RTM) usando a CONTA DE UTILIZADOR (STRING/UUID)
    const rtmToken = RtmTokenBuilder.buildToken(appId, appCertificate, userAccount, privilegeExpiredTs);

    // Envia ambos os tokens e os UIDs correspondentes
    res.json({ 
        rtcToken: rtcToken,
        rtmToken: rtmToken,
        uid_rtc: uid_rtc,           // UID numérico para o RTC
        userAccount: userAccount    // Conta de utilizador (string) para o RTM
    });
});

module.exports = router;