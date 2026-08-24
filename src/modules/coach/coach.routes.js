const { Router } = require("express");
const asyncHandler = require("../../shared/utils/async-handler");
const { authenticateJWT } = require("../auth/auth.middleware");
const { aiRateLimit } = require("../../shared/middleware/ai-rate-limit.middleware");
const { generateCoachInsightsController } = require("./coach.controller");

const router = Router();

router.post("/insights", authenticateJWT, aiRateLimit, asyncHandler(generateCoachInsightsController));

module.exports = router;
