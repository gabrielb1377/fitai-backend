const prisma = require("./prisma");

async function testDatabaseConnection(options = {}) {
  const { disconnect = false } = options;

  try {
    await prisma.$connect();
    await prisma.$queryRaw`SELECT 1`;
    console.log("✓ PostgreSQL conectado");

    return true;
  } catch (err) {
    console.error("PostgreSQL nao conectado. Verifique se o servico local esta ativo e se DATABASE_URL esta correto.");

    const detail = getDatabaseErrorDetail(err);

    if (detail) {
      console.error(`Detalhe: ${detail}`);
    }

    return false;
  } finally {
    if (disconnect) {
      await prisma.$disconnect().catch(() => undefined);
    }
  }
}

function getDatabaseErrorDetail(err) {
  if (!err) {
    return "";
  }

  if (err.code) {
    return err.code;
  }

  if (err.cause) {
    return String(err.cause);
  }

  if (err.message && err.message.trim()) {
    return err.message.trim();
  }

  return "";
}

if (require.main === module) {
  testDatabaseConnection({ disconnect: true })
    .then((connected) => {
      process.exit(connected ? 0 : 1);
    })
    .catch((err) => {
      console.error("Erro inesperado ao testar PostgreSQL.");

      if (err && err.message) {
        console.error(`Detalhe: ${err.message}`);
      }

      process.exit(1);
    });
}

module.exports = {
  testDatabaseConnection
};
