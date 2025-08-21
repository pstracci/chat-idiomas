const express = require('express');
const router = express.Router();
const passport = require('passport');
const bcrypt = require('bcrypt');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const crypto = require('crypto');
const nodemailer = require('nodemailer');

// Configuração do Nodemailer
const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: process.env.EMAIL_PORT,
    secure: true,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});


// Rota de Registro
router.post('/register', async (req, res) => {
    try {
        const { firstName, lastName, nickname, email, password, emailConsent } = req.body;

        // Verifica se email ou nickname já existem
        const existingUser = await prisma.user.findFirst({
            where: { OR: [{ email: email.toLowerCase() }, { nickname }] }
        });

        if (existingUser) {
            const errorType = existingUser.email === email.toLowerCase() ? 'email_exists' : 'nickname_exists';
            return res.redirect(`/register.html?error=${errorType}`);
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        // --- LÓGICA MODIFICADA ---
        // Cria o usuário e o perfil associado em uma única transação
        const user = await prisma.user.create({
            data: {
                nickname,
                email: email.toLowerCase(),
                password: hashedPassword,
                emailConsent: !!emailConsent,
                profile: {
                    create: {
                        firstName: firstName,
                        lastName: lastName,
                    },
                },
            },
        });

        req.login(user, (err) => {
            if (err) {
                console.error("Erro no login automático após registro:", err);
                return res.redirect('/login.html');
            }
            return res.redirect('/');
        });

    } catch (error) {
        console.error("Erro no processo de registro:", error);
        res.redirect('/register.html?error=unknown');
    }
});


// Rota de Login
router.post('/login', passport.authenticate('local', {
    successRedirect: '/',
    failureRedirect: '/login.html?error=true'
}));

// Rota de Logout
router.get('/logout', (req, res, next) => {
    const socketId = req.session.socketId;
    if (socketId && io.sockets.sockets.has(socketId)) {
        console.log(`Desconectando socket ${socketId} no logout.`);
        io.sockets.sockets.get(socketId).disconnect(true);
    }

    req.logout((err) => {
        if (err) { return next(err); }
        req.session.destroy(() => {
            res.clearCookie('connect.sid');
            res.redirect('/');
        });
    });
});

// Rota para verificar status de login
router.get('/api/user/status', (req, res) => {
    if (req.isAuthenticated()) {
        res.json({
            loggedIn: true,
            nickname: req.user.nickname,
            userId: req.user.id
        });
    } else {
        res.json({ loggedIn: false });
    }
});


// Rotas de Recuperação de Senha
router.post('/forgot-password', async (req, res) => {
    try {
        const user = await prisma.user.findUnique({ where: { email: req.body.email.toLowerCase() } });
        if (!user) {
            return res.redirect('/forgot-password.html?error=not_found');
        }

        const token = crypto.randomBytes(20).toString('hex');
        const expires = new Date(Date.now() + 3600000); // 1 hora

        await prisma.user.update({
            where: { email: req.body.email.toLowerCase() },
            data: {
                passwordResetToken: token,
                passwordResetExpires: expires,
            },
        });

        const resetURL = `${req.protocol}://${req.get('host')}/reset-password.html?token=${token}`;
        
        await transporter.sendMail({
            to: user.email,
            from: process.env.EMAIL_USER,
            subject: 'Redefinição de Senha - Verbi',
            html: `Você está recebendo este e-mail porque solicitou a redefinição de senha para sua conta no Verbi.<br><br>
                   Por favor, clique no link a seguir ou cole-o em seu navegador para concluir o processo:<br><br>
                   <a href="${resetURL}">${resetURL}</a><br><br>
                   Se você não solicitou isso, por favor, ignore este e-mail e sua senha permanecerá inalterada.`
        });

        res.redirect('/forgot-password.html?status=success');

    } catch (error) {
        console.error('Erro em /forgot-password:', error);
        res.redirect('/forgot-password.html?error=server_error');
    }
});

router.post('/reset-password', async (req, res) => {
    const { token, password, confirmPassword } = req.body;
    if (password !== confirmPassword) {
        return res.redirect(`/reset-password.html?token=${token}&error=mismatch`);
    }

    try {
        const user = await prisma.user.findFirst({
            where: {
                passwordResetToken: token,
                passwordResetExpires: { gt: new Date() },
            },
        });

        if (!user) {
            return res.redirect(`/reset-password.html?token=${token}&error=invalid`);
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        await prisma.user.update({
            where: { id: user.id },
            data: {
                password: hashedPassword,
                passwordResetToken: null,
                passwordResetExpires: null,
            },
        });

        res.redirect('/login.html?reset=success');
    } catch (error) {
        console.error('Erro em /reset-password:', error);
        res.redirect(`/reset-password.html?token=${token}&error=invalid`);
    }
});

module.exports = router;