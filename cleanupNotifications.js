// cleanupNotifications.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Iniciando a limpeza de notificações órfãs...');

  // 1. Pega todos os IDs válidos da tabela de Conexões
  const existingConnectionIds = await prisma.connection.findMany({
    select: {
      id: true,
    },
  });
  const validIds = new Set(existingConnectionIds.map(conn => conn.id));
  console.log(`Encontrados ${validIds.size} IDs de conexão válidos.`);

  // 2. Encontra todas as notificações que têm um relatedId
  const notificationsWithRelatedId = await prisma.notification.findMany({
    where: {
      relatedId: {
        not: null,
      },
    },
  });

  // 3. Filtra para encontrar apenas as notificações "órfãs"
  const orphanedNotifications = notificationsWithRelatedId.filter(
    notification => !validIds.has(notification.relatedId)
  );
  
  const orphanedIds = orphanedNotifications.map(n => n.id);
  console.log(`Encontradas ${orphanedNotifications.length} notificações órfãs para corrigir.`);

  if (orphanedNotifications.length > 0) {
    // 4. Atualiza as notificações órfãs, definindo relatedId como null
    const result = await prisma.notification.updateMany({
      where: {
        id: {
          in: orphanedIds,
        },
      },
      data: {
        relatedId: null,
      },
    });
    console.log(`Sucesso! ${result.count} notificações foram corrigidas.`);
  } else {
    console.log('Nenhuma notificação órfã encontrada. Seus dados estão limpos!');
  }
}

main()
  .catch(e => {
    console.error('Ocorreu um erro durante a limpeza:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });