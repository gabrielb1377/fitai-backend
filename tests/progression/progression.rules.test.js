const test = require("node:test");
const assert = require("node:assert/strict");
const { ACTIONS, calculateExerciseProgression } = require("../../src/modules/progression/progression.rules");
const { validateProgressionRequest } = require("../../src/modules/progression/progression.schemas");

const exercise = { id: "supino", name: "Supino reto", equipment: ["barra"] };
const sessions = (reps, weight = 80) => reps.map((value) => ({ sets: [{ weight, reps: value }, { weight, reps: value }, { weight, reps: value }] }));

test("sugere aumentar carga depois de duas sessoes no topo da faixa", () => {
  const result = calculateExerciseProgression({ exercise, config: { repRange: "6-12", sets: 3, restSeconds: 90 }, sessions: sessions([12, 12]) });
  assert.equal(result.action, ACTIONS.INCREASE_WEIGHT);
  assert.ok(result.suggestedWeight > 80);
  assert.equal(result.suggestedSets, 3);
});

test("sugere repeticoes quando a ultima sessao esta dentro da faixa", () => {
  const result = calculateExerciseProgression({ exercise, config: { repRange: "6-12" }, sessions: sessions([10]) });
  assert.equal(result.action, ACTIONS.INCREASE_REPS);
  assert.equal(result.suggestedWeight, 80);
});

test("reduz carga e preserva descanso em queda recente", () => {
  const result = calculateExerciseProgression({ exercise, config: { repRange: "6-12", restSeconds: 45 }, sessions: sessions([4, 4]) });
  assert.equal(result.action, ACTIONS.REDUCE_WEIGHT);
  assert.ok(result.suggestedWeight < 80);
  assert.ok(result.suggestedRestSeconds >= 60);
});

test("aplica deload apos tres sessoes abaixo da faixa", () => {
  const result = calculateExerciseProgression({ exercise, config: { repRange: "6-12", sets: 4 }, sessions: sessions([4, 4, 4]) });
  assert.equal(result.action, ACTIONS.DELOAD);
  assert.equal(result.suggestedSets, 3);
});

test("retorna dados insuficientes sem historico", () => {
  const result = calculateExerciseProgression({ exercise, sessions: [] });
  assert.equal(result.action, ACTIONS.INSUFFICIENT_DATA);
});

test("aceita o contrato publico com history e currentConfig", () => {
  const validation = validateProgressionRequest({
    exerciseId: "supino",
    exerciseKey: "id:supino",
    history: sessions([10]),
    goal: "hipertrofia",
    level: "intermediario",
    currentConfig: { sets: 3, repRange: "6-12", restSeconds: 90 }
  });
  assert.equal(validation.valid, true);
  assert.equal(validation.data.exercise.id, "supino");
  assert.equal(validation.data.sessions.length, 1);
});
