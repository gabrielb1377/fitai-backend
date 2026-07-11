const express = require("express");
const asyncHandler = require("../../shared/utils/async-handler");
const {
  syncStepsController,
  todayStepsController,
  rangeStepsController,
  statsStepsController
} = require("./steps.controller");

const router = express.Router();

router.post("/sync", asyncHandler(syncStepsController));
router.get("/today", asyncHandler(todayStepsController));
router.get("/range", asyncHandler(rangeStepsController));
router.get("/stats", asyncHandler(statsStepsController));

module.exports = router;
