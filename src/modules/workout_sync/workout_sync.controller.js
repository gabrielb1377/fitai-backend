const AppError = require("../../shared/errors/app-error");
const { parseWorkoutSyncBatch, formatZodIssues } = require("./workout_sync.schemas");
const workoutSyncService = require("./workout_sync.service");

async function postWorkoutSyncEventsController(req, res) {
  const parsed = parseWorkoutSyncBatch(req.body);

  if (!parsed.success) {
    throw new AppError(
      "Lote de eventos de treino invalido.",
      400,
      "invalid_workout_sync_batch",
      formatZodIssues(parsed.error)
    );
  }

  const result = await workoutSyncService.processBatch({
    userId: req.auth.userId,
    ...parsed.data
  });

  return res.status(200).json(result);
}

module.exports = { postWorkoutSyncEventsController };
