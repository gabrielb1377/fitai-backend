const { validateProgressionRequest } = require("./progression.schemas");
const { generateExerciseProgression } = require("./progression.service");

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

module.exports = { generateExerciseProgressionController };
