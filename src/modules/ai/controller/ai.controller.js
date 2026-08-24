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

async function generateWorkoutController(req, res) {
  const validation = validateWorkoutRequest(req.body);

  if (!validation.valid) {
    return res.status(400).json({
      error: "invalid_request",
      message: "Body invalido para gerar treino.",
      details: validation.errors
    });
  }

  const idempotencyKey = readIdempotencyKey(req);
  const claim = await claimAiUsage({
    userId: req.auth.userId,
    operation: AI_OPERATIONS.workout,
    idempotencyKey,
    input: validation.data
  });
  if (claim.kind === "replay") {
    return res.status(200).set("Idempotent-Replay", "true").json(claim.response);
  }

  try {
    const context = await loadWorkoutContext(req.auth.userId, validation.data);
    const workout = await generateWorkout(validation.data, context);
    await completeAiUsage(claim.usage.id, workout);
    return res.status(200).json(workout);
  } catch (error) {
    await failAiUsage(claim.usage.id, error);
    throw error;
  }
}

module.exports = {
  generateWorkoutController
};
