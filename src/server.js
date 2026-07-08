require("dotenv").config();

const express = require("express");
const aiRoutes = require("./routes/ai.routes");

const app = express();
const port = Number(process.env.PORT) || 3001;

app.use(express.json());

app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    service: "fitai-backend",
    timestamp: new Date().toISOString()
  });
});

app.use("/ai", aiRoutes);

app.use((req, res) => {
  res.status(404).json({
    error: "not_found",
    message: "Rota nao encontrada."
  });
});

app.use((err, req, res, next) => {
  const statusCode = err.statusCode || 500;

  res.status(statusCode).json({
    error: err.code || "internal_error",
    message: err.message || "Erro interno no servidor."
  });
});

if (require.main === module) {
  app.listen(port, () => {
    console.log(`FitIA backend running on port ${port}`);
  });
}

module.exports = app;
