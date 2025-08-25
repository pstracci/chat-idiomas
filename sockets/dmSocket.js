// sockets/dmSocket.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Função para encontrar ou criar uma conversa entre dois usuários
async function findOrCreateConversation(userId1, userId2) {
    // Tenta encontrar uma conversa existente
    let conversation = await prisma.conversation.findFirst({
        where: {
            AND: [
                { participants: { some: { id: userId1 } } },
                { participants: { some: { id: userId2 } } }
            ]
        }
    });

    // Se não existir, cria uma nova
    if (!conversation) {
        conversation = await prisma.conversation.create({
            data: {
                participants: {
                    connect: [{ id: userId1 }, { id: userId2 }]
                }
            }
        });
    }
    return conversation;
}

// Função principal que anexa os listeners de DM ao socket do usuário
function handleDMEvents(socket, io, userSocketMap) {
    socket.on('directMessage', async (data) => {
        if (!socket.request.user) return; // Segurança: apenas usuários logados

        const senderId = socket.request.user.id;
        const { recipientId, text } = data;

        try {
            const conversation = await findOrCreateConversation(senderId, recipientId);

            const newMessage = await prisma.message.create({
                data: {
                    text: text,
                    senderId: senderId,
                    conversationId: conversation.id,
                }
            });

            // Envia a mensagem para todas as conexões do destinatário
            if (userSocketMap[recipientId]) {
                 userSocketMap[recipientId].forEach(socketId => {
                    io.to(socketId).emit('newDirectMessage', newMessage);
                });
            }

            // Envia a mensagem de volta para todas as conexões do remetente (para sincronia entre abas)
            if (userSocketMap[senderId]) {
                userSocketMap[senderId].forEach(socketId => {
                    io.to(socketId).emit('newDirectMessage', newMessage);
                });
            }

        } catch (error) {
            console.error('Erro ao processar DM no servidor:', error);
            socket.emit('dm_error', { message: 'Não foi possível enviar a mensagem.' });
        }
    });
}

module.exports = { handleDMEvents };