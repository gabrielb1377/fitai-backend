const test = require("node:test");
const assert = require("node:assert/strict");
const AppError = require("../../src/shared/errors/app-error");
const { parseWorkoutResponse, parseJson } = require("../../src/modules/ai/response.parser");
const { validateWorkoutResponse } = require("../../src/modules/ai/workout.validator");

const validWorkout = {
  nome: "ABCD - Hipertrofia",
  descricao: "Treino gerado para hipertrofia.",
  objetivo: "hipertrofia",
  nivel: "intermediario",
  dias: [
    {
      nome: "Dia A",
      grupo: "Peito + Triceps",
      exercicios: [
        {
          nome: "Supino reto",
          series: 4,
          repeticoes: "8-12",
          descansoSegundos: 75,
          observacoes: "Manter controle de movimento."
        }
      ]
    }
  ]
};

test("parseWorkoutResponse parses output_text JSON", () => {
  const parsed = parseWorkoutResponse({
    output_text: JSON.stringify(validWorkout)
  });

  assert.equal(parsed.nome, "ABCD - Hipertrofia");
  assert.equal(parsed.dias.length, 1);
});

test("parseJson accepts fenced JSON", () => {
  const parsed = parseJson("```json\n" + JSON.stringify(validWorkout) + "\n```");

  assert.equal(parsed.objetivo, "hipertrofia");
});

test("validateWorkoutResponse rejects incomplete workouts", () => {
  const validation = validateWorkoutResponse({
    nome: "Treino incompleto"
  });

  assert.equal(validation.valid, false);
  assert.ok(validation.errors.length > 0);
});

test("parseWorkoutResponse throws standardized error for invalid JSON", () => {
  assert.throws(
    () => parseWorkoutResponse({ output_text: "{invalid" }),
    (err) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 502);
      assert.equal(err.code, "invalid_ai_json");
      return true;
    }
  );
});
