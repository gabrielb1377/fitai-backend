const { Router } = require("express");
const asyncHandler = require("../../shared/utils/async-handler");
const { authenticateJWT } = require("../auth/auth.middleware");
const { pushController, pullController } = require("./activity_sync.controller");

const router = Router();
router.use(authenticateJWT);
router.post("/sync", asyncHandler(pushController));
router.get("/sync", asyncHandler(pullController));

module.exports = router;
