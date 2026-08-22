require("dotenv").config();

const minimumJwtSecretLength = 32;

function createEnv(values = process.env) {
  const nodeEnv = requiredText(values.NODE_ENV, "NODE_ENV", "development");
  const databaseUrl = requiredDatabaseUrl(values.DATABASE_URL);
  const jwtSecret = requiredJwtSecret(values.JWT_SECRET);

  return Object.freeze({
    nodeEnv,
    port: optionalPort(values.PORT),
    databaseUrl,
    jwtSecret,
    jwtExpiresIn: optionalText(values.JWT_EXPIRES_IN, "7d"),
    jwtRefreshExpiresIn: optionalText(values.JWT_REFRESH_EXPIRES_IN, "30d"),
    openaiApiKey: optionalText(values.OPENAI_API_KEY),
    openaiModel: optionalText(values.OPENAI_MODEL, "gpt-4o-mini"),
    openaiTimeoutMs: optionalPositiveInteger(values.OPENAI_TIMEOUT_MS, 30000),
    openaiMaxRetries: optionalPositiveInteger(values.OPENAI_MAX_RETRIES, 2),
    serviceName: "fitai-backend"
  });
}

function requiredDatabaseUrl(value) {
  const databaseUrl = requiredText(value, "DATABASE_URL");
  try {
    const parsed = new URL(databaseUrl);
    if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
      throw new Error("DATABASE_URL deve usar postgresql:// ou postgres://.");
    }
  } catch (error) {
    throw new Error(`Configuracao invalida de DATABASE_URL: ${error.message}`);
  }
  return databaseUrl;
}

function requiredJwtSecret(value) {
  const jwtSecret = requiredText(value, "JWT_SECRET");
  if (jwtSecret.length < minimumJwtSecretLength) {
    throw new Error(
      `JWT_SECRET deve ter pelo menos ${minimumJwtSecretLength} caracteres aleatorios.`
    );
  }
  if (/replace_with|change_me|local-development|fitai_password/i.test(jwtSecret)) {
    throw new Error("JWT_SECRET usa um valor de exemplo ou previsivel.");
  }
  return jwtSecret;
}

function requiredText(value, name, fallback) {
  const text = optionalText(value, fallback);
  if (!text) throw new Error(`Variavel obrigatoria ausente: ${name}.`);
  return text;
}

function optionalText(value, fallback = "") {
  const text = typeof value === "string" ? value.trim() : "";
  return text || fallback;
}

function optionalPort(value) {
  const port = Number(optionalText(value, "3001"));
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT deve ser um inteiro entre 1 e 65535.");
  }
  return port;
}

function optionalPositiveInteger(value, fallback) {
  const parsed = Number(optionalText(value, String(fallback)));
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error("Configuracao numerica deve ser um inteiro nao negativo.");
  }
  return parsed;
}

module.exports = {
  ...createEnv(),
  createEnv,
  minimumJwtSecretLength
};
