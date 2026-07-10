const test = require("node:test");
const assert = require("node:assert/strict");
const { validateWorkoutRequest } = require("../../src/modules/ai/schemas/workout.schema");

const baseRequest = {
  objetivo: "hipertrofia",
  divisao: "ABCD",
  nivel: "intermediario",
  diasPorSemana: 4,
  tempoPorTreino: 60,
  local: "academia",
  equipamentos: ["barra", "halteres"],
  restricoes: [],
  prioridades: []
};

test("validateWorkoutRequest defaults minExerciciosPorDia to 6", () => {
  const validation = validateWorkoutRequest(baseRequest);

  assert.equal(validation.valid, true);
  assert.equal(validation.data.minExerciciosPorDia, 6);
});

test("validateWorkoutRequest accepts allowed minExerciciosPorDia", () => {
  const validation = validateWorkoutRequest({
    ...baseRequest,
    minExerciciosPorDia: 9
  });

  assert.equal(validation.valid, true);
  assert.equal(validation.data.minExerciciosPorDia, 9);
});

test("validateWorkoutRequest rejects invalid minExerciciosPorDia", () => {
  const validation = validateWorkoutRequest({
    ...baseRequest,
    minExerciciosPorDia: 5
  });

  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.includes("minExerciciosPorDia")));
});
