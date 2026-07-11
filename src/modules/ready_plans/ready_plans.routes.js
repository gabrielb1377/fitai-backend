const { Router } = require("express");
const asyncHandler = require("../../shared/utils/async-handler");
const {
  listReadyPlansController,
  getReadyPlanController,
  listReadyPlanCategoriesController
} = require("./ready_plans.controller");

const router = Router();

router.get("/categories", asyncHandler(listReadyPlanCategoriesController));
router.get("/", asyncHandler(listReadyPlansController));
router.get("/:id", asyncHandler(getReadyPlanController));

module.exports = router;
