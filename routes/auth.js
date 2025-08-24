const express = require('express');
const router = express.Router();
const passport = require('passport');
const bcrypt = require('bcrypt');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const crypto = require('crypto');
const nodemailer = require('nodemailer');

// Configuração do Nodemailer (existente)
const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: process.env.EMAIL_PORT,
    secure: false,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// Função para enviar e-mail de verificação (existente)
async function sendVerificationEmail(user, req) {
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 3600000 * 24); // Token expira em 24 horas

    await prisma.user.update({
        where: { id: user.id },
        data: {
            emailConfirmationToken: token,
            emailConfirmationTokenExpires: expires,
        },
    });

   const verificationURL = `${req.protocol}://${req.get('host')}/verify-email?token=${token}`;

    await transporter.sendMail({
        to: user.email,
        from: `"Verbi" <${process.env.SENDER_EMAIL}>`, // <-- MUDANÇA IMPORTANTE AQUI
        subject: 'Confirme seu E-mail no Verbi',
        html: `
            <p>Olá ${user.profile.firstName},</p>
            <p>Bem-vindo ao Verbi! Por favor, clique no link abaixo para ativar sua conta:</p>
            <a href="${verificationURL}">${verificationURL}</a>
            <p>Este link expirará em 24 horas.</p>
        `
    });
}


// Rota de Registro (sem alterações)
router.post('/register', async (req, res) => {
    try {
        const { firstName, lastName, dateOfBirth, nickname, email, password, emailConsent } = req.body;

        const existingUser = await prisma.user.findFirst({
            where: { OR: [{ email: email.toLowerCase() }, { nickname }] }
        });

        if (existingUser) {
            const errorType = existingUser.email === email.toLowerCase() ? 'email_exists' : 'nickname_exists';
            return res.redirect(`/register.html?error=${errorType}`);
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const user = await prisma.user.create({
            data: {
                nickname,
                email: email.toLowerCase(),
                password: hashedPassword,
                emailConsent: !!emailConsent,
                isVerified: false,
                profile: {
                    create: {
                        firstName: firstName,
                        lastName: lastName,
                        dateOfBirth: new Date(dateOfBirth),
                    },
                },
            },
            include: {
                profile: true
            }
        });

        await sendVerificationEmail(user, req);

        return res.redirect('/verify-notice.html');

    } catch (error) {
        console.error("Erro no processo de registro:", error);
        res.redirect('/register.html?error=unknown');
    }
});

// Rota de Login (sem alterações)
router.post('/login', (req, res, next) => {
    passport.authenticate('local', (err, user, info) => {
        if (err) {
            return next(err);
        }
        if (!user) {
            return res.redirect('/login.html?error=true');
        }

        if (!user.isVerified) {
            const emailParam = encodeURIComponent(req.body.email);
            return res.redirect(`/login.html?error=not_verified&email=${emailParam}`);
        }

        req.login(user, (err) => {
            if (err) {
                return next(err);
            }
            return res.redirect('/');
        });
    })(req, res, next);
});


// Rota para reenviar o e-mail de verificação (sem alterações)
router.get('/resend-verification', async (req, res) => {
    try {
        const email = req.query.email;
        if (!email) {
            return res.redirect('/login.html');
        }

        const user = await prisma.user.findUnique({
            where: { email: email.toLowerCase() },
            include: { profile: true }
        });

        if (user && !user.isVerified) {
            await sendVerificationEmail(user, req);
            return res.redirect('/login.html?status=resent');
        }
        
        return res.redirect('/login.html');

    } catch (error) {
        console.error("Erro ao reenviar e-mail de verificação:", error);
        return res.redirect('/login.html?error=server_error');
    }
});


// --- ALTERAÇÃO ---: Rota de verificação de e-mail foi modificada para adicionar a notificação
router.get('/verify-email', async (req, res) => {
    const { token } = req.query;

    try {
        const user = await prisma.user.findFirst({
            where: {
                emailConfirmationToken: token,
                emailConfirmationTokenExpires: { gt: new Date() },
            },
        });

        if (!user) {
            return res.redirect('/login.html?error=invalid_token');
        }

        // Usando uma transação para garantir que ambas as operações funcionem
        await prisma.$transaction([
            // 1. Atualiza o usuário para o status verificado
            prisma.user.update({
                where: { id: user.id },
                data: {
                    isVerified: true,
                    emailConfirmationToken: null,
                    emailConfirmationTokenExpires: null,
                },
            }),
            // 2. --- NOVO: Cria a notificação de boas-vindas ---
            prisma.notification.create({
                data: {
                    userId: user.id,
                    type: 'SYSTEM_MESSAGE',
                    content: 'Bem-vindo(a) ao Verbi! Explore as salas de chat e conecte-se com pessoas do mundo todo.',
                },
            }),
        ]);

        res.redirect('/login.html?verified=success');

    } catch (error) {
        console.error('Erro na verificação de e-mail:', error);
        res.redirect('/login.html?error=invalid_token');
    }
});


// Rota de Logout (sem alterações)
router.get('/logout', (req, res, next) => {
    req.logout((err) => {
        if (err) { return next(err); }
        req.session.destroy(() => {
            res.clearCookie('connect.sid');
            res.redirect('/');
        });
    });
});

// Rota para verificar status de login (sem alterações)
router.get('/api/user/status', async (req, res) => {
    if (req.isAuthenticated()) {
        try {
            const userId = req.user.id;
            const [userWithProfile, connections, pendingRequests] = await Promise.all([
                prisma.user.findUnique({ where: { id: userId }, include: { profile: true } }),
                prisma.connection.findMany({ where: { status: 'ACCEPTED', OR: [{ requesterId: userId }, { addresseeId: userId }] }, include: { requester: { select: { id: true, nickname: true, profile: { select: { profilePicture: true } } } }, addressee: { select: { id: true, nickname: true, profile: { select: { profilePicture: true } } } } } }),
                prisma.connection.findMany({ where: { addresseeId: userId, status: 'PENDING' }, include: { requester: { select: { id: true, nickname: true, profile: { select: { profilePicture: true } } } } } })
            ]);
            const friends = connections.map(conn => {
                const friend = conn.requesterId === userId ? conn.addressee : conn.requester;
                return { connectionId: conn.id, friendInfo: { id: friend.id, nickname: friend.nickname, profilePicture: friend.profile?.profilePicture } };
            });
            res.json({ loggedIn: true, user: { id: userWithProfile.id, nickname: userWithProfile.nickname, role: req.user.role, profile: userWithProfile.profile }, connections: friends, pendingRequests: pendingRequests });
        } catch (error) {
            console.error("Erro ao buscar status completo do usuário:", error);
            res.status(500).json({ loggedIn: false, error: 'Erro interno do servidor' });
        }
    } else {
        res.json({ loggedIn: false });
    }
});


// Rotas de Recuperação de Senha (sem alterações)
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
            data: { passwordResetToken: token, passwordResetExpires: expires, },
        });
        const resetURL = `${req.protocol}://${req.get('host')}/reset-password.html?token=${token}`;
        await transporter.sendMail({
            to: user.email,
            from: `Verbi <${process.env.EMAIL_USER}>`,
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
            where: { passwordResetToken: token, passwordResetExpires: { gt: new Date() }, },
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