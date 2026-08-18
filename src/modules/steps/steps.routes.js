const express = require("express");
const asyncHandler = require("../../shared/utils/async-handler");
const { authenticateJWT } = require("../auth/auth.middleware");
const {
  syncStepsController,
  todayStepsController,
  rangeStepsController,
  statsStepsController
} = require("./steps.controller");

const router = express.Router();

// Step records are private user data; a client/device identifier is not auth.
router.use(authenticateJWT);

router.post("/sync", asyncHandler(syncStepsController));
router.get("/today", asyncHandler(todayStepsController));
router.get("/range", asyncHandler(rangeStepsController));
router.get("/stats", asyncHandler(statsStepsController));

module.exports = router;
