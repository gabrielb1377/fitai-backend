const test = require("node:test");
const assert = require("node:assert/strict");
const AppError = require("../../src/shared/errors/app-error");
const { generateWorkout } = require("../../src/modules/ai/service/workout_ai.service");
const { parseWorkoutResponse } = require("../../src/modules/ai/response.parser");
const { normalizeProviderError } = require("../../src/modules/coach/coach.service");

const input = {
  objetivo: "hipertrofia",
  divisao: "ABC",
  nivel: "iniciante",
  diasPorSemana: 3,
  tempoPorTreino: 45,
  local: "academia",
  equipamentos: ["halteres"],
  restricoes: [],
  prioridades: [],
  minExerciciosPorDia: 6,
  observacoes: ""
};

test("AI-11: provider com resposta valida retorna somente output validado", async () => {
  const result = await generateWorkout(input, { autenticado: true }, {
    generateWithProvider: async () => buildWorkout()
  });

  assert.equal(result.dias.length, 1);
  assert.equal(result.dias[0].exercicios.length, 6);
});

test("AI-12/13/15: falhas do provider permanecem controladas", () => {
  const timeout = normalizeProviderError({ name: "APIConnectionTimeoutError" });
  const unavailable = normalizeProviderError({ status: 503 });
  const limited = normalizeProviderError({ status: 429 });

  assert.equal(timeout.code, "ai_provider_timeout");
  assert.equal(unavailable.code, "ai_provider_unavailable");
  assert.equal(limited.code, "ai_provider_rate_limited");
});

test("AI-14: output invalido nao e normalizado silenciosamente", () => {
  assert.throws(
    () => parseWorkoutResponse({ output_text: JSON.stringify({ nome: "incompleto" }) }, input),
    (error) => error instanceof AppError && error.code === "invalid_ai_response"
  );
});

function buildWorkout() {
  const exercises = Array.from({ length: 6 }, (_, index) => ({
    id: `exercise-${index}`,
    nome: `Exercicio ${index}`,
    categoria: "Peito",
    musculos: ["Peito"],
    equipamentos: ["Halteres"],
    series: 3,
    repeticoes: "8-12",
    descanso: 90
  }));
  return {
    id: "workout-1",
    nome: "ABC - Hipertrofia",
    descricao: "Treino valido.",
    objetivo: "hipertrofia",
    nivel: "iniciante",
    tempoEstimado: 45,
    criadoPorIA: true,
    dataCriacao: new Date().toISOString(),
    dias: [{ id: "day-1", nome: "Dia A", titulo: "Peito", diaSemana: "Segunda", exercicios: exercises }],
    exercicios: []
  };
}
