// generate-users.js (CORRIGIDO)

const { PrismaClient } = require('@prisma/client');
// ALTERAÇÃO 1: Importar a classe Faker e os locais específicos que vamos usar.
const { Faker, pt_BR, en_US, es, fr, ja } = require('@faker-js/faker');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

// Pool de idiomas que os usuários podem querer aprender.
const potentialLanguagesToLearn = ['Inglês', 'Espanhol', 'Francês', 'Alemão', 'Japonês', 'Italiano', 'Coreano'];

// Configuração para a geração de usuários por país.
const countryConfigs = [
    {
        countryName: "Brasil",
        locale: pt_BR, // ALTERAÇÃO 2: Acessar os locais importados diretamente
        language: "Português",
        count: 80
    },
    {
        countryName: "Estados Unidos",
        locale: en_US,
        language: "Inglês",
        count: 5
    },
    {
        countryName: "Espanha",
        locale: es,
        language: "Espanhol",
        count: 5
    },
    {
        countryName: "França",
        locale: fr,
        language: "Francês",
        count: 5
    },
    {
        countryName: "Japão",
        locale: ja,
        language: "Japonês",
        count: 5
    }
];

async function main() {
    console.log('Iniciando o script de geração de usuários...');

    const saltRounds = 10;
    const genericPassword = 'password123';
    const hashedPassword = await bcrypt.hash(genericPassword, saltRounds);

    for (const config of countryConfigs) {
        console.log(`--- Gerando ${config.count} usuários para o país: ${config.countryName} ---`);

        // ALTERAÇÃO 3: Criar uma instância localizada do Faker para cada país.
        const localFaker = new Faker({ locale: config.locale });

        for (let i = 0; i < config.count; i++) {
            // ALTERAÇÃO 4: Usar a instância 'localFaker' em vez da global 'faker'.
            const firstName = localFaker.person.firstName();
            const lastName = localFaker.person.lastName();
            const email = localFaker.internet.email({ firstName, lastName, provider: 'test.com' }).toLowerCase();
            
            let nickname = (firstName.toLowerCase().replace(/[^a-z]/g, '') + Math.floor(Math.random() * 999)).substring(0, 10);
            
            const existingNickname = await prisma.user.findFirst({ where: { nickname } });
            if (existingNickname) {
                nickname = (nickname.substring(0, 7) + Math.floor(Math.random() * 999)).substring(0, 10);
            }

            const dateOfBirth = localFaker.date.birthdate({ min: 18, max: 70, mode: 'age' });
            
            const languagesSpoken = JSON.stringify([{
                language: config.language,
                level: "Nativo"
            }]);

            const languagesLearning = [...potentialLanguagesToLearn]
                .filter(lang => lang !== config.language)
                .sort(() => 0.5 - Math.random())
                .slice(0, Math.floor(Math.random() * 3) + 1);

            try {
                await prisma.user.create({
                    data: {
                        nickname,
                        email,
                        password: hashedPassword,
                        isVerified: true,
                        profile: {
                            create: {
                                firstName,
                                lastName,
                                dateOfBirth,
                                country: config.countryName,
                                languagesSpoken,
                                languagesLearning
                            },
                        },
                    },
                });
                console.log(`- Usuário criado: ${nickname} (${email}) de ${config.countryName}`);
            } catch (e) {
                if (e.code === 'P2002' && e.meta?.target.includes('email')) {
                    console.warn(`! E-mail já existe, pulando: ${email}`);
                } else {
                    console.error(`! Erro ao criar usuário ${nickname}:`, e);
                }
            }
        }
    }
}

main()
    .catch((e) => {
        console.error('Ocorreu um erro durante a execução do script:', e);
        process.exit(1);
    })
    .finally(async () => {
        console.log('Script finalizado. Desconectando do banco de dados...');
        await prisma.$disconnect();
    });