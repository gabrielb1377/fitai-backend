const { Router } = require("express");
const asyncHandler = require("../../../shared/utils/async-handler");
const { authenticateJWT } = require("../../auth/auth.middleware");
const {
  listUsersController,
  getUserController,
  updateUserController,
  deleteUserController,
  getProfileController,
  updateProfileController
} = require("../controller/users.controller");

const router = Router();

router.get("/users", authenticateJWT, asyncHandler(listUsersController));
router.get("/users/:id", authenticateJWT, asyncHandler(getUserController));
router.patch("/users/:id", authenticateJWT, asyncHandler(updateUserController));
router.delete("/users/:id", authenticateJWT, asyncHandler(deleteUserController));

router.get("/profile", authenticateJWT, asyncHandler(getProfileController));
router.patch("/profile", authenticateJWT, asyncHandler(updateProfileController));

module.exports = router;
