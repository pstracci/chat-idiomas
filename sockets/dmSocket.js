// sockets/dmSocket.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// [CORRIGIDO] Função para encontrar ou criar uma conversa com base no seu schema
async function findOrCreateConversation(userId1, userId2) {
    // Passo 1: Encontrar a conversa.
    // A busca agora filtra pelo campo 'B' (que representa o userId)
    // na sua tabela de ligação explícita '_participants'.
    let conversation = await prisma.conversation.findFirst({
        where: {
            AND: [
                { participants: { some: { B: userId1 } } }, // Alterado de 'id' para 'B'
                { participants: { some: { B: userId2 } } }  // Alterado de 'id' para 'B'
            ]
        }
    });

    // Passo 2: Se não encontrar, criar a conversa.
    if (!conversation) {
        // Ao criar, precisamos gerar as entradas na tabela de ligação 'participants'.
        // Usamos 'create' para inserir os dois registros (um para cada usuário)
        // associados a esta nova conversa.
        conversation = await prisma.conversation.create({
            data: {
                participants: {
                    create: [
                        { B: userId1 }, // Cria a ligação para o primeiro usuário
                        { B: userId2 }  // Cria a ligação para o segundo usuário
                    ]
                }
            }
        });
    }
    return conversation;
}

// Função principal que anexa os listeners de DM ao socket do usuário
function handleDMEvents(socket, io) {
    socket.on('directMessage', async (data) => {
        if (!socket.request.user) return;

        const senderId = socket.request.user.id;
        const { recipientId, text, imageData } = data;

        if (!text && !imageData) {
            console.log('Tentativa de enviar mensagem vazia recebida.');
            return;
        }

        try {
            // Esta função agora está corrigida e funcionará com seu schema
            const conversation = await findOrCreateConversation(senderId, recipientId);

            const newMessage = await prisma.message.create({
                data: {
                    text: text,
                    imageData: imageData,
                    senderId: senderId,
                    conversationId: conversation.id,
                },
                // [MELHORIA] Inclui dados do remetente para o front-end não precisar de outra busca
                include: {
                    sender: {
                        select: {
                            id: true,
                            nickname: true,
                            profile: {
                                select: {
                                    profilePicture: true
                                }
                            }
                        }
                    }
                }
            });

            // [CORREÇÃO APLICADA]
            // Cria um novo objeto de payload que inclui o 'recipientId'.
            // Isso é crucial para a lógica no front-end do remetente funcionar corretamente.
            const payload = {
                ...newMessage,
                recipientId: recipientId 
            };

            // Envia o 'payload' completo em vez de apenas 'newMessage'.
            io.to(recipientId).emit('directMessage', payload);
            io.to(senderId).emit('directMessage', payload); // Sincroniza outras abas do remetente

        } catch (error) {
            console.error('Erro ao processar DM no servidor:', error);
            socket.emit('dm_error', { message: 'Não foi possível enviar a mensagem.' });
        }
    });
}

module.exports = { handleDMEvents };