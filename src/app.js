const express = require("express");
const env = require("./config/env");
const aiRoutes = require("./modules/ai/routes/ai.routes");
const activitySyncRoutes = require("./modules/activity_sync/activity_sync.routes");
const authRoutes = require("./modules/auth/auth.routes");
const coachRoutes = require("./modules/coach/coach.routes");
const progressionRoutes = require("./modules/progression/progression.routes");
const readyPlansRoutes = require("./modules/ready_plans/ready_plans.routes");
const stepsRoutes = require("./modules/steps/steps.routes");
const syncRoutes = require("./modules/sync/sync.routes");
const workoutSyncRoutes = require("./modules/workout_sync/workout_sync.routes");
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
  app.use("/activities", activitySyncRoutes);
  app.use("/coach", coachRoutes);
  app.use("/progression", progressionRoutes);
  app.use("/ready-plans", readyPlansRoutes);
  app.use("/steps", stepsRoutes);
  app.use("/sync", syncRoutes);
  app.use("/workout-sync", workoutSyncRoutes);

  app.use(notFoundMiddleware);
  app.use(errorHandlerMiddleware);

  return app;
}

module.exports = createApp;
