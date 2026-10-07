const { isOpenAIEnabled, generateWorkoutWithOpenAI } = require("../openai.service");
const { buildSafeFallbackWorkout, normalizeWorkoutResponse } = require("../workout.validator");

async function generateWorkout(input, context, dependencies = {}) {
  const generationInput = {
    ...input,
    contextoUsuario: context || null
  };
  if (!isOpenAIEnabled() && !dependencies.generateWithProvider) {
    console.info("[ai] operation=workout_generation mode=mock external_generation=false");
    return generateMockWorkout(generationInput);
  }

  const generateWithProvider = dependencies.generateWithProvider || generateWorkoutWithOpenAI;
  return generateWithProvider(generationInput, { requestId: dependencies.requestId });
}

function generateMockWorkout(input) {
  const workout = buildSafeFallbackWorkout(input);
  const validation = normalizeWorkoutResponse(workout, input, { source: "mock" });

  if (!validation.valid) {
    throw new Error("Mock de treino invalido.");
  }

  return validation.data;
}

module.exports = {
  generateWorkout,
  generateMockWorkout
};
