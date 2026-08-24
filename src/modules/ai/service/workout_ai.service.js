const { isOpenAIEnabled, generateWorkoutWithOpenAI } = require("../openai.service");
const { buildSafeFallbackWorkout, normalizeWorkoutResponse } = require("../workout.validator");

async function generateWorkout(input, context, dependencies = {}) {
  const generationInput = {
    ...input,
    contextoUsuario: context || null
  };
  console.info(`[ai] operation=workout_generation minExerciciosPorDia=${input.minExerciciosPorDia}`);

  if (!isOpenAIEnabled() && !dependencies.generateWithProvider) {
    console.info("[ai] modo=MOCK reason=OPENAI_API_KEY ausente");
    return generateMockWorkout(generationInput);
  }

  console.info("[ai] modo=OPENAI");

  try {
    const generateWithProvider = dependencies.generateWithProvider || generateWorkoutWithOpenAI;
    return await generateWithProvider(generationInput);
  } catch (err) {
    console.error(`[ai] provider_failure code=${err.code || "openai_error"}`);
    throw err;
  }
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
