const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcrypt');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Guarda o ID do usuário na sessão após o login
passport.serializeUser((user, done) => {
    done(null, user.id);
});

// Busca o usuário completo no banco a cada requisição, usando o ID da sessão
passport.deserializeUser(async (id, done) => {
    try {
        const user = await prisma.user.findUnique({ where: { id } });
        done(null, user);
    } catch (err) {
        done(err);
    }
});

// Define a "estratégia" de login com email e senha
passport.use(new LocalStrategy({ usernameField: 'email' }, async (email, password, done) => {
    try {
        const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });

        if (!user) {
            return done(null, false, { message: 'Este e-mail não está cadastrado.' });
        }
        if (!user.password) {
            return done(null, false, { message: 'Este usuário se cadastrou com uma rede social.' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return done(null, false, { message: 'Senha incorreta.' });
        }
        
        return done(null, user); // Sucesso!
    } catch (err) {
        return done(err);
    }
}));