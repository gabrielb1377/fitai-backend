const { validateCoachRequest } = require("./coach.schemas");
const { generateCoachInsights } = require("./coach.service");
const {
  AI_OPERATIONS,
  readIdempotencyKey,
  claimAiUsage,
  completeAiUsage,
  failAiUsage
} = require("../ai/ai-usage.service");

async function generateCoachInsightsController(req, res) {
  const validation = validateCoachRequest(req.body);

  if (!validation.valid) {
    return res.status(400).json({
      error: "invalid_request",
      message: "Body invalido para gerar insights do Coach.",
      details: validation.errors
    });
  }

  const idempotencyKey = readIdempotencyKey(req);
  const claim = await claimAiUsage({
    userId: req.auth.userId,
    operation: AI_OPERATIONS.coach,
    idempotencyKey,
    input: validation.data
  });
  if (claim.kind === "replay") {
    return res.status(200).set("Idempotent-Replay", "true").json(claim.response);
  }

  try {
    const result = await generateCoachInsights(req.auth.userId, validation.data);
    await completeAiUsage(claim.usage.id, result);
    return res.status(200).json(result);
  } catch (error) {
    await failAiUsage(claim.usage.id, error);
    throw error;
  }
}

module.exports = {
  generateCoachInsightsController
};
