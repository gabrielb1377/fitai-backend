const { generateWorkout } = require("../service/workout_ai.service");
const { loadWorkoutContext } = require("../context.service");
const { validateWorkoutRequest } = require("../schemas/workout.schema");
const {
  AI_OPERATIONS,
  readIdempotencyKey,
  claimAiUsage,
  completeAiUsage,
  failAiUsage
} = require("../ai-usage.service");

function createGenerateWorkoutController(dependencies = {}) {
  const usageClaim = dependencies.claimAiUsage || claimAiUsage;
  const usageComplete = dependencies.completeAiUsage || completeAiUsage;
  const usageFail = dependencies.failAiUsage || failAiUsage;
  const loadContext = dependencies.loadWorkoutContext || loadWorkoutContext;
  const generate = dependencies.generateWorkout || generateWorkout;
  return async function generateWorkoutController(req, res) {
    const validation = validateWorkoutRequest(req.body);

    if (!validation.valid) {
      return res.status(400).json({
        error: "invalid_request",
        message: "Body invalido para gerar treino.",
        details: validation.errors
      });
    }

    const idempotencyKey = readIdempotencyKey(req);
    const claim = await usageClaim({
      userId: req.auth.userId,
      operation: AI_OPERATIONS.workout,
      idempotencyKey,
      input: validation.data
    });
    if (claim.kind === "replay") {
      return res.status(200).set("Idempotent-Replay", "true").json(claim.response);
    }

    try {
      const context = await loadContext(req.auth.userId, validation.data);
      const workout = await generate(validation.data, context, { requestId: claim.usage.id });
      await usageComplete(claim.usage.id, workout);
      return res.status(200).json(workout);
    } catch (error) {
      await usageFail(claim.usage.id, error);
      throw error;
    }
  };
}

const generateWorkoutController = createGenerateWorkoutController();

module.exports = {
  generateWorkoutController,
  createGenerateWorkoutController
};
