const { Router } = require("express");
const { authenticateJWT } = require("../auth/auth.middleware");
const asyncHandler = require("../../shared/utils/async-handler");
const { postWorkoutSyncEventsController } = require("./workout_sync.controller");

const router = Router();

router.get("/history", authenticateJWT, asyncHandler(async (req, res) => {
  const result = await require("../sync/sync.read.service").pullHistory(req.auth.userId, req.query);
  res.json(result);
}));

router.post("/events", authenticateJWT, asyncHandler(postWorkoutSyncEventsController));

module.exports = router;
