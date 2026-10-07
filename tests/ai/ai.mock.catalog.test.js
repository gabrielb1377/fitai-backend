const test = require("node:test");
const assert = require("node:assert/strict");
const { generateMockWorkout } = require("../../src/modules/ai/service/workout_ai.service");
const { projection, normalizeName, validateWorkoutCatalog } = require("../../src/modules/ai/gateway/catalog");

const r16Input = {
  objetivo: "hipertrofia",
  divisao: "ABC",
  nivel: "iniciante",
  diasPorSemana: 3,
  tempoPorTreino: 45,
  minExerciciosPorDia: 6,
  local: "academia",
  equipamentos: ["halteres"],
  restricoes: [],
  prioridades: []
};

test("AI-MOCK-CATALOG-01: todos os exercícios do mock R1.6 têm binding canônico seguro", () => {
  const workout = generateMockWorkout(r16Input);
  const exercises = workout.dias.flatMap((day) => day.exercicios);
  const unresolved = exercises
    .map((exercise) => ({
      name: exercise.nome,
      normalized: normalizeName(exercise.nome),
      canonicalId: Object.hasOwn(projection.nameBindings, normalizeName(exercise.nome))
        ? projection.nameBindings[normalizeName(exercise.nome)]
        : null
    }))
    .filter((exercise) => exercise.canonicalId === null);

  assert.equal(workout.dias.length, 3);
  assert.equal(exercises.length, 18);
  assert.deepEqual(unresolved, []);
  assert.doesNotThrow(() => validateWorkoutCatalog(workout, "ai-mock-catalog-test"));
});
