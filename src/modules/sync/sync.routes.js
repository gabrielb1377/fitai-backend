const { Router } = require("express");
const asyncHandler = require("../../shared/utils/async-handler");
const {
  postProfileController,
  getProfileController,
  postGoalsController,
  getGoalsController,
  postRecordsController,
  getRecordsController,
  postWorkoutsController,
  getWorkoutsController,
  postWorkoutHistoryController,
  postRunningController
} = require("./sync.controller");

const router = Router();

router.post("/profile", asyncHandler(postProfileController));
router.get("/profile", asyncHandler(getProfileController));

router.post("/goals", asyncHandler(postGoalsController));
router.get("/goals", asyncHandler(getGoalsController));

router.post("/records", asyncHandler(postRecordsController));
router.get("/records", asyncHandler(getRecordsController));

router.post("/workouts", asyncHandler(postWorkoutsController));
router.get("/workouts", asyncHandler(getWorkoutsController));

router.post("/workout-history", asyncHandler(postWorkoutHistoryController));
router.post("/running", asyncHandler(postRunningController));

module.exports = router;
