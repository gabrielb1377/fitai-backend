const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const env = require("./env");

const globalForPrisma = globalThis;

function createPrismaClient() {
  const adapter = new PrismaPg({
    connectionString: env.databaseUrl
  });

  return new PrismaClient({ adapter });
}

const prisma = globalForPrisma.__fitaiPrisma || createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__fitaiPrisma = prisma;
}

module.exports = prisma;
