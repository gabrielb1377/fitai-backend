const { validateCoachRequest } = require("./coach.schemas");
const { generateCoachInsights } = require("./coach.service");

async function generateCoachInsightsController(req, res) {
  const validation = validateCoachRequest(req.body);

  if (!validation.valid) {
    return res.status(400).json({
      error: "invalid_request",
      message: "Body invalido para gerar insights do Coach.",
      details: validation.errors
    });
  }

  const result = await generateCoachInsights(req, validation.data);

  return res.status(200).json(result);
}

module.exports = {
  generateCoachInsightsController
};
