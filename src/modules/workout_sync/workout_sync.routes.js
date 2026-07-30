const { Router } = require("express");
const { authenticateJWT } = require("../auth/auth.middleware");
const asyncHandler = require("../../shared/utils/async-handler");
const { postWorkoutSyncEventsController } = require("./workout_sync.controller");

const router = Router();

router.post("/events", authenticateJWT, asyncHandler(postWorkoutSyncEventsController));

module.exports = router;
