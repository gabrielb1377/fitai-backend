const { generateWorkout } = require("../service/workout_ai.service");
const { validateWorkoutRequest } = require("../schemas/workout.schema");

async function generateWorkoutController(req, res) {
  const validation = validateWorkoutRequest(req.body);

  if (!validation.valid) {
    return res.status(400).json({
      error: "invalid_request",
      message: "Body invalido para gerar treino.",
      details: validation.errors
    });
  }

  const workout = await generateWorkout(validation.data);

  return res.status(200).json(workout);
}

module.exports = {
  generateWorkoutController
};
