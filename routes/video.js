// routes/video.js
const express = require('express');
const router = express.Router();
const { RtcTokenBuilder, RtcRole } = require('agora-token');

// Middleware de autenticação
function isAuthenticated(req, res, next) {
    if (req.isAuthenticated()) {
        return next();
    }
    res.status(401).json({ error: 'Não autorizado' });
}

// Função para converter UUID em um inteiro de 32 bits
function uuidToUint32(uuid) {
    const hex = uuid.replace(/-/g, '').substring(0, 8);
    return parseInt(hex, 16);
}

// --- ROTA CORRIGIDA ---
// 1. Método alterado de POST para GET.
// 2. Caminho alterado de '/generate-token' para '/token'.
router.get('/token', isAuthenticated, (req, res) => {

 // ================== ADICIONE ESTE LOG PARA DEBUG ==================
    console.log("--- DEBUG: Verificando variáveis de ambiente do Agora ---");
    console.log("App ID que o servidor está usando:", process.env.AGORA_APP_ID);
    console.log("Certificado que o servidor está usando:", process.env.AGORA_APP_CERTIFICATE);
    console.log("Canal recebido do front-end:", req.query.channel);
    console.log("---------------------------------------------------------");
    // ===================================================================
	
    // 3. Leitura alterada de req.body para req.query para pegar o parâmetro da URL.
    const channelName = req.query.channel; 
    if (!channelName) {
        return res.status(400).json({ error: 'O nome do canal (channel) é obrigatório na URL.' });
    }

    const APP_ID = process.env.AGORA_APP_ID;
    const APP_CERTIFICATE = process.env.AGORA_APP_CERTIFICATE;

    if (!APP_ID || !APP_CERTIFICATE) {
        console.error("Credenciais do Agora não configuradas no servidor.");
        return res.status(500).json({ error: 'Erro de configuração do servidor.' });
    }
    
    const uid = uuidToUint32(req.user.id);
    const role = RtcRole.PUBLISHER;
    const expirationTimeInSeconds = 3600; // Token válido por 1 hora
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const privilegeExpiredTs = currentTimestamp + expirationTimeInSeconds;

    try {
        const token = RtcTokenBuilder.buildTokenWithUid(APP_ID, APP_CERTIFICATE, channelName, uid, role, privilegeExpiredTs);

        // A resposta agora corresponde exatamente ao que o front-end espera
        res.json({
            appId: APP_ID,
            channel: channelName,
            token: token,
            uid: uid
        });

    } catch (error) {
        console.error("Erro ao gerar token do Agora:", error);
        res.status(500).json({ message: 'Não foi possível gerar o token de vídeo.' });
    }
});

module.exports = router;