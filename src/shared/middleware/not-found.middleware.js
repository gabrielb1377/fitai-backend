const AppError = require("../errors/app-error");

function notFoundMiddleware(req, res, next) {
  next(new AppError("Rota nao encontrada.", 404, "not_found"));
}

module.exports = notFoundMiddleware;
