const test = require("node:test");
const assert = require("node:assert/strict");
const AppError = require("../../src/shared/errors/app-error");
const { generateMockWorkout } = require("../../src/modules/ai/service/workout_ai.service");
const { parseWorkoutResponse, parseJson } = require("../../src/modules/ai/response.parser");
const { validateWorkoutResponse } = require("../../src/modules/ai/workout.validator");

const requestInput = {
  objetivo: "hipertrofia",
  divisao: "ABCD",
  nivel: "intermediario",
  diasPorSemana: 4,
  tempoPorTreino: 60,
  local: "academia",
  equipamentos: ["barra", "halteres", "maquinas"],
  restricoes: [],
  prioridades: ["peito", "costas"],
  observacoes: ""
};

test("generateMockWorkout returns Flutter-compatible workout JSON", () => {
  const workout = generateMockWorkout(requestInput);
  const validation = validateWorkoutResponse(workout);

  assert.equal(validation.valid, true);
  assert.equal(workout.criadoPorIA, true);
  assert.equal(workout.tempoEstimado, 60);
  assert.ok(workout.id);
  assert.ok(workout.dias.length > 0);
  assert.ok(workout.dias[0].exercicios.length > 0);
  assert.equal(Array.isArray(workout.exercicios), true);
});

test("parseWorkoutResponse parses complete output_text JSON", () => {
  const validWorkout = generateMockWorkout(requestInput);
  const parsed = parseWorkoutResponse({
    output_text: JSON.stringify(validWorkout)
  }, requestInput);

  assert.equal(parsed.nome, "ABCD - Hipertrofia");
  assert.equal(parsed.criadoPorIA, true);
  assert.equal(parsed.dias.length, 4);
});

test("parseWorkoutResponse normalizes incomplete OpenAI JSON", () => {
  const parsed = parseWorkoutResponse({
    output_text: JSON.stringify({
      nome: "Treino gerado",
      dias: [
        {
          nome: "Dia A",
          grupo: "Peito + Triceps",
          exercicios: [
            {
              nome: "Supino reto",
              series: 3,
              repeticoes: "8-12",
              descansoSegundos: 90
            }
          ]
        }
      ]
    })
  }, requestInput);

  assert.equal(parsed.criadoPorIA, true);
  assert.equal(parsed.tempoEstimado, 60);
  assert.ok(parsed.id);
  assert.ok(parsed.dias[0].id);
  assert.equal(parsed.dias[0].titulo, "Peito + Triceps");
  assert.equal(parsed.dias[0].exercicios[0].descanso, 90);
});

test("parseJson accepts fenced JSON", () => {
  const workout = generateMockWorkout(requestInput);
  const parsed = parseJson("```json\n" + JSON.stringify(workout) + "\n```");

  assert.equal(parsed.objetivo, "hipertrofia");
});

test("validateWorkoutResponse rejects empty workout days", () => {
  const workout = generateMockWorkout(requestInput);
  const validation = validateWorkoutResponse({
    ...workout,
    dias: []
  });

  assert.equal(validation.valid, false);
  assert.ok(validation.errors.length > 0);
});

test("parseWorkoutResponse throws standardized error for invalid JSON", () => {
  assert.throws(
    () => parseWorkoutResponse({ output_text: "{invalid" }, requestInput),
    (err) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 502);
      assert.equal(err.code, "invalid_ai_json");
      return true;
    }
  );
});
