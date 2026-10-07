const AppError = require("../../shared/errors/app-error");
const { parseBatch, parsePull, formatZodIssues } = require("./activity_sync.schemas");
const activitySyncService = require("./activity_sync.service");

async function pushController(req, res) {
  const parsed = parseBatch(req.body);
  if (!parsed.success) {
    throw new AppError(
      "Lote de atividades invalido.",
      400,
      "invalid_activity_sync_batch",
      formatZodIssues(parsed.error)
    );
  }
  const result = await activitySyncService.processBatch({
    userId: req.auth.userId,
    ...parsed.data
  });
  return res.status(200).json(result);
}

async function pullController(req, res) {
  const parsed = parsePull(req.query);
  if (!parsed.success) {
    throw new AppError(
      "Consulta de atividades invalida.",
      400,
      "invalid_activity_sync_pull",
      formatZodIssues(parsed.error)
    );
  }
  return res.status(200).json({
    contractVersion: parsed.data.contractVersion,
    state: await activitySyncService.pullState({
      userId: req.auth.userId,
      afterRevision: parsed.data.afterRevision
    })
  });
}

module.exports = { pushController, pullController };
