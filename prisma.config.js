require("dotenv").config();

const { defineConfig } = require("prisma/config");

module.exports = defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations"
  },
  datasource: {
    url: process.env.DATABASE_URL || "postgresql://fitai_user:fitai_password@localhost:5432/fitai_db?schema=public"
  }
});
