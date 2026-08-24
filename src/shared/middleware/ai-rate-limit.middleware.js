const { rateLimit, ipKeyGenerator } = require("express-rate-limit");
const env = require("../../config/env");

function createAiRateLimit(options = {}) {
  return rateLimit({
    windowMs: options.windowMs ?? env.aiRateLimitWindowMs,
    limit: options.limit ?? env.aiRateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.auth && req.auth.userId ? `user:${req.auth.userId}` : ipKeyGenerator(req.ip),
    message: {
      error: "too_many_ai_requests",
      message: "Muitas solicitacoes de IA em pouco tempo. Tente novamente em instantes."
    }
  });
}

const aiRateLimit = createAiRateLimit();

module.exports = { aiRateLimit, createAiRateLimit };
