function errorHandlerMiddleware(err, req, res, next) {
  const statusCode = err.statusCode || 500;

  res.status(statusCode).json({
    error: err.code || "internal_error",
    message: err.message || "Erro interno no servidor."
  });
}

module.exports = errorHandlerMiddleware;
