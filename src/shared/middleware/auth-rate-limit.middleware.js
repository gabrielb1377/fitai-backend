const rateLimit = require("express-rate-limit");

function createAuthRateLimit(options = {}) {
  return rateLimit({
    windowMs: options.windowMs ?? 15 * 60 * 1000,
    limit: options.limit ?? 10,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    message: {
      error: "too_many_auth_attempts",
      message: "Muitas tentativas. Aguarde alguns minutos antes de tentar novamente."
    }
  });
}

const authRateLimit = createAuthRateLimit();

module.exports = {
  authRateLimit,
  createAuthRateLimit
};
