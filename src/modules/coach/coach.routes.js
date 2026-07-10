const { Router } = require("express");
const asyncHandler = require("../../shared/utils/async-handler");
const { generateCoachInsightsController } = require("./coach.controller");

const router = Router();

router.post("/insights", asyncHandler(generateCoachInsightsController));

module.exports = router;
