const { Router } = require("express");
const asyncHandler = require("../../shared/utils/async-handler");
const { authenticateJWT } = require("../auth/auth.middleware");
const {
  generateExerciseProgressionController,
  pushProgressionEventsController,
  pullProgressionController
} = require("./progression.controller");

const router = Router();

router.post("/exercise", asyncHandler(generateExerciseProgressionController));
router.post(
  "/sync/events",
  authenticateJWT,
  asyncHandler(pushProgressionEventsController)
);
router.get("/sync", authenticateJWT, asyncHandler(pullProgressionController));

module.exports = router;
