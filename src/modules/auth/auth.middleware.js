const AppError = require("../../shared/errors/app-error");
const { verifyToken } = require("./auth.service");

function authenticateJWT(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const [scheme, token] = authHeader.split(" ");

  if (scheme !== "Bearer" || !token) {
    return next(new AppError("Token JWT nao informado.", 401, "missing_token"));
  }

  try {
    const payload = verifyToken(token);

    req.auth = {
      userId: payload.sub,
      email: payload.email
    };

    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  authenticateJWT
};
