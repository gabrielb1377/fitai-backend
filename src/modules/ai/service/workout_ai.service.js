const { isOpenAIEnabled, generateWorkoutWithOpenAI } = require("../openai.service");
const { buildSafeFallbackWorkout, normalizeWorkoutResponse } = require("../workout.validator");

async function generateWorkout(input) {
  if (!isOpenAIEnabled()) {
    console.info("[ai] modo=MOCK reason=OPENAI_API_KEY ausente");
    return generateMockWorkout(input);
  }

  console.info("[ai] modo=OPENAI");

  try {
    return await generateWorkoutWithOpenAI(input);
  } catch (err) {
    console.error(`[ai] fallback aplicado. reason=${err.code || "openai_error"}`);
    return generateMockWorkout(input);
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
