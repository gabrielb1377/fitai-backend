const { Router } = require("express");
const { generateWorkout } = require("../services/workout_ai.service");
const { validateWorkoutRequest } = require("../schemas/workout.schema");

const router = Router();

router.post("/generate-workout", (req, res, next) => {
  try {
    const validation = validateWorkoutRequest(req.body);

    if (!validation.valid) {
      return res.status(400).json({
        error: "invalid_request",
        message: "Body invalido para gerar treino.",
        details: validation.errors
      });
    }

    const workout = generateWorkout(validation.data);

    return res.status(200).json(workout);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
