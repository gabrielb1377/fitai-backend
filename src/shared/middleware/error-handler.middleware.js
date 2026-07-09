function errorHandlerMiddleware(err, req, res, next) {
  const statusCode = err.statusCode || 500;
  const payload = {
    error: err.code || "internal_error",
    message: err.message || "Erro interno no servidor."
  };

  if (err.details) {
    payload.details = err.details;
  }

  res.status(statusCode).json(payload);
}

module.exports = errorHandlerMiddleware;
