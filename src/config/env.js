require("dotenv").config();

const defaultDatabaseUrl = "postgresql://fitai_user:fitai_password@localhost:5432/fitai_db?schema=public";

const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT) || 3001,
  databaseUrl: process.env.DATABASE_URL || defaultDatabaseUrl,
  serviceName: "fitai-backend"
};

module.exports = env;
