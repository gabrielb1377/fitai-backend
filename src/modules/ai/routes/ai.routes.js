const { Router } = require("express");
const asyncHandler = require("../../../shared/utils/async-handler");
const { generateWorkoutController } = require("../controller/ai.controller");

const router = Router();

router.post("/generate-workout", asyncHandler(generateWorkoutController));

module.exports = router;
