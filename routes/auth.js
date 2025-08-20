const express = require('express');
const router = express.Router();
const passport = require('passport');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Rota para o formulário de CADASTRO
router.post('/register', async (req, res, next) => {
    try {
        const { firstName, lastName, age, nickname, email, password, emailConsent } = req.body;

        const existingEmail = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
        if (existingEmail) {
            return res.redirect('/register.html?error=email_exists');
        }

        const existingNickname = await prisma.user.findUnique({ where: { nickname } });
        if (existingNickname) {
            return res.redirect('/register.html?error=nickname_exists');
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = await prisma.user.create({
            data: {
                firstName, lastName, age: parseInt(age), nickname,
                email: email.toLowerCase(), password: hashedPassword,
                emailConsent: !!emailConsent
            }
        });

        req.login(newUser, (err) => {
            if (err) { return next(err); }
            return res.redirect('/');
        });
    } catch (err) {
        console.error("Erro no registro:", err);
        res.redirect('/register.html?error=unknown');
    }
});

// Rota para o formulário de LOGIN
router.post('/login', passport.authenticate('local', {
    successRedirect: '/',
    failureRedirect: '/login.html?error=1',
}));

// Rota de LOGOUT
router.get('/logout', (req, res, next) => {
    req.logout((err) => {
        if (err) { return next(err); }
        res.redirect('/');
    });
});

// --- NOVAS ROTAS DE REDEFINIÇÃO DE SENHA ---

// Rota para lidar com a solicitação de redefinição de senha
router.post('/forgot-password', async (req, res) => {
    try {
        const user = await prisma.user.findFirst({ 
    where: { email: { equals: req.body.email, mode: 'insensitive' } } 
});
        if (!user || !user.password) { // Não encontra ou é usuário de rede social
            return res.redirect('/forgot-password.html?error=notfound');
        }

        const token = crypto.randomBytes(20).toString('hex');
        const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

        await prisma.user.update({
            where: { id: user.id },
            data: {
                passwordResetToken: hashedToken,
                passwordResetExpires: new Date(Date.now() + 3600000) // 1 hora
            }
        });

        const resetURL = `http://${req.headers.host}/reset-password.html?token=${token}`;
        
        // Configuração do Nodemailer
        let transporter = nodemailer.createTransport({
            host: process.env.EMAIL_HOST,
            port: 587,
            secure: false,
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS,
            },
        });
        
        await transporter.sendMail({
            from: `"Verbi" <${process.env.EMAIL_USER}>`,
            to: user.email,
            subject: "Redefinição de Senha - Verbi",
            html: `<p>Você solicitou a redefinição da sua senha.</p>
                   <p>Clique neste <a href="${resetURL}">link</a> para criar uma nova senha.</p>
                   <p>Este link expira em 1 hora.</p>`,
        });

        res.redirect('/forgot-password.html?status=success');

    } catch (err) {
        console.error("Erro no forgot-password:", err);
        res.redirect('/forgot-password.html?error=unknown');
    }
});

// Rota para lidar com a submissão da nova senha
router.post('/reset-password', async (req, res) => {
    const { token, password, confirmPassword } = req.body;

    if (password !== confirmPassword) {
        return res.redirect(`/reset-password.html?token=${token}&error=mismatch`);
    }

    try {
        const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
        const user = await prisma.user.findFirst({
            where: {
                passwordResetToken: hashedToken,
                passwordResetExpires: { gt: new Date() }
            }
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
                passwordResetExpires: null
            }
        });

        res.redirect('/login.html?reset=success');

    } catch (err) {
        console.error("Erro no reset-password:", err);
        res.redirect(`/reset-password.html?token=${token}&error=unknown`);
    }
});


module.exports = router;