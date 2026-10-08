const { Router } = require("express");
const asyncHandler = require("../../shared/utils/async-handler");
const { authenticateJWT } = require("../auth/auth.middleware");
const {
  postProfileController,
  getProfileController,
  postGoalsController,
  getGoalsController,
  postRecordsController,
  getRecordsController,
  postWorkoutsController,
  getWorkoutsController,
  postWorkoutDeleteController,
  postWorkoutHistoryController,
  postExerciseHistoryController,
  postRunningController
} = require("./sync.controller");

const router = Router();

// Sync data is always owned by the authenticated user. Device/client IDs are
// transport metadata only and must never define data ownership.
router.use(authenticateJWT);

router.post("/profile", asyncHandler(postProfileController));
router.get("/profile", asyncHandler(getProfileController));

router.post("/goals", asyncHandler(postGoalsController));
router.get("/goals", asyncHandler(getGoalsController));

router.post("/records", asyncHandler(postRecordsController));
router.get("/records", asyncHandler(getRecordsController));

router.post("/workouts", asyncHandler(postWorkoutsController));
router.get("/workouts", asyncHandler(getWorkoutsController));
router.get("/workouts/deletions", asyncHandler(async (req, res) => {
  const result = await require("./sync.read.service").pullPlanDeletions(req.auth.userId, req.query);
  res.json(result);
}));
router.post("/workouts/delete", asyncHandler(postWorkoutDeleteController));

router.post("/workout-history", asyncHandler(postWorkoutHistoryController));
router.post("/exercise-history", asyncHandler(postExerciseHistoryController));
router.post("/running", asyncHandler(postRunningController));

module.exports = router;
