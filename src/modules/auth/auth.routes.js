const { Router } = require("express");
const asyncHandler = require("../../shared/utils/async-handler");
const {
  registerController,
  loginController,
  meController
} = require("./auth.controller");
const { authenticateJWT } = require("./auth.middleware");
const { authRateLimit } = require("../../shared/middleware/auth-rate-limit.middleware");

const router = Router();

router.post("/register", authRateLimit, asyncHandler(registerController));
router.post("/login", authRateLimit, asyncHandler(loginController));
router.get("/me", authenticateJWT, asyncHandler(meController));

module.exports = router;
