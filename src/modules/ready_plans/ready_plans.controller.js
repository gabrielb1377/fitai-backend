const AppError = require("../../shared/errors/app-error");
const readyPlansService = require("./ready_plans.service");
const { parseReadyPlanId } = require("./ready_plans.schemas");

async function listReadyPlansController(req, res) {
  return res.status(200).json(await readyPlansService.listReadyPlans());
}

async function getReadyPlanController(req, res) {
  const validation = parseReadyPlanId(req.params);

  if (!validation.valid) {
    throw new AppError("Identificador de plano pronto invalido.", 400, "invalid_ready_plan_id", validation.errors);
  }

  return res.status(200).json(await readyPlansService.getReadyPlanById(validation.data.id));
}

async function listReadyPlanCategoriesController(req, res) {
  return res.status(200).json(await readyPlansService.listReadyPlanCategories());
}

async function copyReadyPlanController(req, res) {
  const validation = parseReadyPlanId(req.params);

  if (!validation.valid) {
    throw new AppError("Identificador de plano pronto invalido.", 400, "invalid_ready_plan_id", validation.errors);
  }

  const result = await readyPlansService.copyReadyPlan(req, validation.data.id);
  return res.status(201).json(result);
}

async function listReadyPlanFavoritesController(req, res) {
  return res.status(200).json(
    await readyPlansService.listReadyPlanFavorites(req.auth.userId)
  );
}

async function addReadyPlanFavoriteController(req, res) {
  const validation = parseReadyPlanId(req.params);
  if (!validation.valid) {
    throw new AppError("Identificador de plano pronto invalido.", 400, "invalid_ready_plan_id", validation.errors);
  }

  return res.status(201).json(
    await readyPlansService.addReadyPlanFavorite(req.auth.userId, validation.data.id)
  );
}

async function removeReadyPlanFavoriteController(req, res) {
  const validation = parseReadyPlanId(req.params);
  if (!validation.valid) {
    throw new AppError("Identificador de plano pronto invalido.", 400, "invalid_ready_plan_id", validation.errors);
  }

  return res.status(200).json(
    await readyPlansService.removeReadyPlanFavorite(req.auth.userId, validation.data.id)
  );
}

module.exports = {
  listReadyPlansController,
  getReadyPlanController,
  listReadyPlanCategoriesController,
  copyReadyPlanController,
  listReadyPlanFavoritesController,
  addReadyPlanFavoriteController,
  removeReadyPlanFavoriteController
};
