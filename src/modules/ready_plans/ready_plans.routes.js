const { Router } = require("express");
const asyncHandler = require("../../shared/utils/async-handler");
const { authenticateJWT } = require("../auth/auth.middleware");
const {
  listReadyPlansController,
  getReadyPlanController,
  listReadyPlanCategoriesController,
  copyReadyPlanController,
  listReadyPlanFavoritesController,
  addReadyPlanFavoriteController,
  removeReadyPlanFavoriteController
} = require("./ready_plans.controller");

const router = Router();

router.get("/categories", asyncHandler(listReadyPlanCategoriesController));
router.get("/favorites", authenticateJWT, asyncHandler(listReadyPlanFavoritesController));
router.get("/", asyncHandler(listReadyPlansController));
router.post("/:id/copy", asyncHandler(copyReadyPlanController));
router.post("/:id/favorite", authenticateJWT, asyncHandler(addReadyPlanFavoriteController));
router.delete("/:id/favorite", authenticateJWT, asyncHandler(removeReadyPlanFavoriteController));
router.get("/:id", asyncHandler(getReadyPlanController));

module.exports = router;
