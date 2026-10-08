const { validateProgressionRequest } = require("./progression.schemas");
const { generateExerciseProgression } = require("./progression.service");
const AppError = require("../../shared/errors/app-error");
const {
  parseProgressionSyncBatch,
  parseProgressionPullQuery,
  formatZodIssues
} = require("./progression.sync.schemas");
const progressionSyncService = require("./progression.sync.service");

async function generateExerciseProgressionController(req, res) {
  const validation = validateProgressionRequest(req.body);
  if (!validation.valid) {
    return res.status(400).json({
      error: "invalid_request",
      message: "Body invalido para calcular a progressao do exercicio.",
      details: validation.errors
    });
  }

  const progression = generateExerciseProgression(validation.data);
  if (process.env.NODE_ENV !== "production") {
    console.info(`[Progression] ${progression.exerciseKey}: ${progression.action}.`);
  }
  return res.status(200).json(progression);
}

async function pushProgressionEventsController(req, res) {
  const parsed = parseProgressionSyncBatch(req.body);
  if (!parsed.success) {
    throw new AppError(
      "Lote de progressao invalido.",
      400,
      "invalid_progression_sync_batch",
      formatZodIssues(parsed.error)
    );
  }

  const result = await progressionSyncService.processBatch({
    userId: req.auth.userId,
    ...parsed.data
  });
  return res.status(200).json(result);
}

async function pullProgressionController(req, res) {
  const parsed = parseProgressionPullQuery(req.query);
  if (!parsed.success) {
    throw new AppError(
      "Consulta de progressao invalida.",
      400,
      "invalid_progression_pull",
      formatZodIssues(parsed.error)
    );
  }

  const state = await progressionSyncService.pullState({
    userId: req.auth.userId,
    afterRevision: parsed.data.afterRevision
  });
  return res.status(200).json({
    contractVersion: parsed.data.contractVersion,
    rulesVersion: progressionSyncService.RULES_VERSION,
    state
  });
}

module.exports = {
  generateExerciseProgressionController,
  pushProgressionEventsController,
  pullProgressionController
};
