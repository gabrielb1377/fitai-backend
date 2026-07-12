const { Router } = require("express");
const asyncHandler = require("../../shared/utils/async-handler");
const { generateExerciseProgressionController } = require("./progression.controller");

const router = Router();

router.post("/exercise", asyncHandler(generateExerciseProgressionController));

module.exports = router;
