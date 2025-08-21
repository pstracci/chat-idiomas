// routes/profile.js
const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Middleware para garantir que o usuário está autenticado
function isAuthenticated(req, res, next) {
    if (req.isAuthenticated()) {
        return next();
    }
    res.status(401).json({ error: 'Não autorizado' });
}

// Rota para buscar o perfil do próprio usuário logado
router.get('/me', isAuthenticated, async (req, res) => {
    try {
        const profile = await prisma.profile.findUnique({
            where: { userId: req.user.id },
            include: { user: { select: { email: true, nickname: true } } },
        });

        // Se o perfil não existir por algum motivo, cria um perfil básico
        if (!profile) {
            const newProfile = await prisma.profile.create({
                data: { 
                    userId: req.user.id,
                    firstName: req.user.firstName, // Puxa dados do registro inicial
                    lastName: req.user.lastName,   // Puxa dados do registro inicial
                },
                include: { user: { select: { email: true, nickname: true } } },
            });
            return res.json(newProfile);
        }

        res.json(profile);
    } catch (error) {
        console.error("Erro ao buscar perfil:", error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// Rota para atualizar o perfil do usuário logado
router.put('/me', isAuthenticated, async (req, res) => {
    const { nickname, firstName, lastName, dateOfBirth, phone, country, profilePicture, languagesSpoken, languagesLearning } = req.body;
    
    try {
        // Atualiza os dados em ambos os modelos (User e Profile) em uma única transação
        const [, updatedProfile] = await prisma.$transaction([
            prisma.user.update({
                where: { id: req.user.id },
                data: { nickname: nickname }, // Simplesmente atualiza o nickname
            }),
            prisma.profile.update({
                where: { userId: req.user.id },
                data: {
                    firstName,
                    lastName,
                    dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
                    phone,
                    country,
                    profilePicture,
                    languagesSpoken,
                    languagesLearning
                },
            })
        ]);
        
        res.json(updatedProfile);
    } catch (error) {
        console.error("Erro ao atualizar perfil:", error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// Rota de busca por usuários
// Trecho novo e aprimorado da busca
router.get('/search', isAuthenticated, async (req, res) => {
    const query = req.query.q;
    if (!query) {
        return res.json([]);
    }
    try {
        const users = await prisma.user.findMany({
            where: {
                // Garante que você não apareça nos resultados
                id: {
                    not: req.user.id,
                },
                // Busca no nickname OU no nome/sobrenome do perfil
                OR: [
                    {
                        nickname: {
                            contains: query,
                            mode: 'insensitive',
                        }
                    },
                    {
                        profile: {
                            firstName: {
                                contains: query,
                                mode: 'insensitive',
                            }
                        }
                    },
                    {
                        profile: {
                            lastName: {
                                contains: query,
                                mode: 'insensitive',
                            }
                        }
                    }
                ]
            },
            take: 5, // Limita a 5 resultados para a pré-visualização
            select: {
                id: true,
                nickname: true,
                profile: {
                    select: {
                        profilePicture: true,
                    },
                },
            },
        });
        res.json(users);
    } catch (error) {
        console.error("Erro na busca de usuários:", error);
        res.status(500).json({ error: 'Erro ao buscar usuários' });
    }
});

// Rota para buscar o perfil público de um usuário pelo seu ID
router.get('/:userId', isAuthenticated, async (req, res) => {
    try {
        const profile = await prisma.profile.findUnique({
            where: { userId: req.params.userId },
            include: {
                user: {
                    select: {
                        id: true,
                        nickname: true,
                        isOnline: true,
                        lastSeen: true,
                    },
                },
            },
        });

        if (!profile) {
            return res.status(404).json({ error: 'Perfil não encontrado' });
        }
        
        // Retornamos um objeto de perfil "público", sem dados sensíveis como telefone.
        const publicProfile = {
            ...profile,
            phone: undefined, // Garante que o telefone não seja exposto
            user: {
                ...profile.user,
                email: undefined // Garante que o email não seja exposto
            }
        };

        res.json(publicProfile);

    } catch (error) {
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

module.exports = router;