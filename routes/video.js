// routes/video.js
const express = require('express');
const { RtcTokenBuilder, RtcRole } = require('agora-token');

const router = express.Router();

// Função para gerar o token do Agora (CORRIGIDA)
const generateAgoraToken = (req, res) => {
    // Defina o tempo de expiração do token (ex: 24 horas para chamadas mais longas)
    const expirationTimeInSeconds = 86400;
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const privilegeExpiredTs = currentTimestamp + expirationTimeInSeconds;

    // Pegue suas credenciais das variáveis de ambiente
    const APP_ID = process.env.AGORA_APP_ID;
    const APP_CERTIFICATE = process.env.AGORA_APP_CERTIFICATE;

    if (!APP_ID || !APP_CERTIFICATE) {
        return res.status(500).json({ error: 'Credenciais do Agora não configuradas no servidor.' });
    }

    // --- LÓGICA DE VALIDAÇÃO REFORÇADA ---
    // 1. Pega o nome do canal EXCLUSIVAMENTE do corpo da requisição.
    const channelName = req.body.channel;
    
    // 2. Se o nome do canal não for fornecido, retorna um erro. Não gera mais nomes aleatórios.
    if (!channelName) {
        return res.status(400).json({ error: 'O nome do canal (channelName) é obrigatório para gerar o token.' });
    }
    
    // O UID pode ser 0 para permitir que qualquer usuário entre (ou você pode passar um UID específico do usuário)
    const uid = 0; 
    const role = RtcRole.PUBLISHER;

    // Construa o token usando o channelName validado
    const token = RtcTokenBuilder.buildTokenWithUid(APP_ID, APP_CERTIFICATE, channelName, uid, role, privilegeExpiredTs);

    // Envie as informações de volta para o front-end
    res.json({
        appId: APP_ID,
        channel: channelName,
        token: token
    });
};

// Defina a rota que o front-end está chamando
router.post('/generate-token', generateAgoraToken);

module.exports = router;