const express = require('express');
const router = express.Router();
const passport = require('passport');
const bcrypt = require('bcrypt');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const crypto = require('crypto');
// ADICIONADO: Biblioteca oficial do SendGrid
const sgMail = require('@sendgrid/mail');

// REMOVIDO: A configuração do Nodemailer foi removida daqui.

// ADICIONADO: Configuração da chave de API do SendGrid.
// Garanta que a variável de ambiente 'SENDGRID_API_KEY' está definida no Railway.
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

// Função para enviar e-mail de verificação (MODIFICADA para usar a API SendGrid)
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
   
    const msg = {
        to: user.email,
        from: {
            name: 'Verbi',
            email: process.env.SENDER_EMAIL // Este deve ser um e-mail verificado como remetente no SendGrid
        },
        subject: 'Confirme seu E-mail no Verbi',
        html: `
            <p>Olá ${user.profile.firstName},</p>
            <p>Bem-vindo ao Verbi! Por favor, clique no link abaixo para ativar sua conta:</p>
            <a href="${verificationURL}">${verificationURL}</a>
            <p>Este link expirará em 24 horas.</p>
        `
    };

    try {
        await sgMail.send(msg);
        console.log(`E-mail de verificação enviado para ${user.email} via SendGrid API.`);
    } catch (error) {
        console.error('Erro ao enviar e-mail de verificação pelo SendGrid:', error);
        if (error.response) {
            console.error(error.response.body);
        }
        throw new Error('Falha ao enviar e-mail de verificação.');
    }
}


// Rota de Registro
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

        const newUser = await prisma.user.create({
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
            }
        });

        const userWithProfile = await prisma.user.findUnique({
            where: { id: newUser.id },
            include: { profile: true }
        });

        await sendVerificationEmail(userWithProfile, req);

        return res.redirect('/verify-notice.html');

    } catch (error) {
        console.error("Erro no processo de registro:", error);
        res.redirect('/register.html?error=unknown');
    }
});

// Rota de Login
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


// Rota para reenviar o e-mail de verificação
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


// Rota de verificação de e-mail
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

        await prisma.$transaction([
            prisma.user.update({
                where: { id: user.id },
                data: {
                    isVerified: true,
                    emailConfirmationToken: null,
                    emailConfirmationTokenExpires: null,
                },
            }),
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


// Rota de Logout
router.get('/logout', (req, res, next) => {
    req.logout((err) => {
        if (err) { return next(err); }
        req.session.destroy(() => {
            res.clearCookie('connect.sid');
            res.redirect('/');
        });
    });
});

// Rota para verificar status de login
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


// Rota de Recuperação de Senha (MODIFICADA para usar a API SendGrid)

router.post('/forgot-password', async (req, res) => {
    try {
        const user = await prisma.user.findUnique({ where: { email: req.body.email.toLowerCase() } });
        if (!user) {
            // Não revele se o usuário existe ou não por segurança, mas redirecione como sucesso.
            return res.redirect('/forgot-password.html?status=success');
        }
        const token = crypto.randomBytes(20).toString('hex');
        const expires = new Date(Date.now() + 3600000); // 1 hora
        await prisma.user.update({
            where: { email: req.body.email.toLowerCase() },
            data: { passwordResetToken: token, passwordResetExpires: expires, },
        });
        const resetURL = `${req.protocol}://${req.get('host')}/reset-password.html?token=${token}`;

        // Cria a mensagem para a API do SendGrid
        const msg = {
            to: user.email,
            from: {
                name: 'Verbi',
                email: process.env.SENDER_EMAIL // Garanta que este e-mail é um remetente verificado no SendGrid
            },
            subject: 'Redefinição de Senha - Verbi',
            html: `Você está recebendo este e-mail porque solicitou a redefinição de senha para sua conta no Verbi.<br><br>
                   Por favor, clique no link a seguir ou cole-o em seu navegador para concluir o processo:<br><br>
                   <a href="${resetURL}">${resetURL}</a><br><br>
                   Se você não solicitou isso, por favor, ignore este e-mail e sua senha permanecerá inalterada.`
        };

        // Envia o e-mail usando a API do SendGrid
        await sgMail.send(msg);
        
        res.redirect('/forgot-password.html?status=success');
    } catch (error) {
        console.error('Erro em /forgot-password:', error);
        if (error.response) {
            console.error(error.response.body);
        }
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