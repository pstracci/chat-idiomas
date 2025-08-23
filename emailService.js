// emailService.js
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: process.env.EMAIL_PORT,
    secure: false, // true for 465, false for other ports
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
});

async function sendVerificationEmail(userEmail, token) {
    const verificationLink = `${process.env.BASE_URL}/verify-email?token=${token}`;

    const mailOptions = {
        from: '"Verbi" <no-reply@verbi.com>',
        to: userEmail,
        subject: 'Confirme seu E-mail no Verbi',
        html: `
            <div style="font-family: Arial, sans-serif; text-align: center; padding: 20px;">
                <h2>Bem-vindo ao Verbi!</h2>
                <p>Por favor, clique no botão abaixo para confirmar seu endereço de e-mail e ativar sua conta.</p>
                <a href="${verificationLink}" style="background-color: #007bff; color: white; padding: 15px 25px; text-decoration: none; border-radius: 5px; display: inline-block; margin-top: 20px;">
                    Confirmar E-mail
                </a>
                <p style="margin-top: 30px; font-size: 0.9em; color: #777;">Se você não se cadastrou no Verbi, por favor, ignore este e-mail.</p>
            </div>
        `,
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log('E-mail de verificação enviado para:', userEmail);
    } catch (error) {
        console.error('Erro ao enviar e-mail de verificação:', error);
    }
}

module.exports = { sendVerificationEmail };