require("dotenv").config();

const defaultDatabaseUrl = "postgresql://fitai_user:fitai_password@localhost:5432/fitai_db?schema=public";

const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT) || 3001,
  databaseUrl: process.env.DATABASE_URL || defaultDatabaseUrl,
  jwtSecret: process.env.JWT_SECRET || "fitai-local-development-secret",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "7d",
  openaiApiKey: process.env.OPENAI_API_KEY || "",
  openaiModel: process.env.OPENAI_MODEL || "gpt-4o-mini",
  openaiTimeoutMs: Number(process.env.OPENAI_TIMEOUT_MS) || 30000,
  openaiMaxRetries: Number(process.env.OPENAI_MAX_RETRIES) || 2,
  serviceName: "fitai-backend"
};

module.exports = env;
