const { Router } = require("express");
const asyncHandler = require("../../../shared/utils/async-handler");
const { authenticateJWT } = require("../../auth/auth.middleware");
const { aiRateLimit } = require("../../../shared/middleware/ai-rate-limit.middleware");
const { generateWorkoutController } = require("../controller/ai.controller");

const router = Router();

router.post("/generate-workout", authenticateJWT, aiRateLimit, asyncHandler(generateWorkoutController));

module.exports = router;
