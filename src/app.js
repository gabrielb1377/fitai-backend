const express = require("express");
const env = require("./config/env");
const aiRoutes = require("./modules/ai/routes/ai.routes");
const authRoutes = require("./modules/auth/auth.routes");
const syncRoutes = require("./modules/sync/sync.routes");
const usersRoutes = require("./modules/users/routes/users.routes");
const { corsMiddleware } = require("./shared/middleware/cors.middleware");
const errorHandlerMiddleware = require("./shared/middleware/error-handler.middleware");
const notFoundMiddleware = require("./shared/middleware/not-found.middleware");

function createApp() {
  const app = express();

  app.options(/.*/, corsMiddleware);
  app.use(corsMiddleware);
  app.use(express.json());

  app.get("/health", (req, res) => {
    res.status(200).json({
      status: "ok",
      service: env.serviceName,
      timestamp: new Date().toISOString()
    });
  });

  app.use("/auth", authRoutes);
  app.use(usersRoutes);
  app.use("/ai", aiRoutes);
  app.use("/sync", syncRoutes);

  app.use(notFoundMiddleware);
  app.use(errorHandlerMiddleware);

  return app;
}

module.exports = createApp;
