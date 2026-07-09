const { Router } = require("express");
const asyncHandler = require("../../shared/utils/async-handler");
const {
  registerController,
  loginController,
  meController
} = require("./auth.controller");
const { authenticateJWT } = require("./auth.middleware");

const router = Router();

router.post("/register", asyncHandler(registerController));
router.post("/login", asyncHandler(loginController));
router.get("/me", authenticateJWT, asyncHandler(meController));

module.exports = router;
