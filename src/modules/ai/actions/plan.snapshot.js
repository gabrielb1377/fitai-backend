const { createHash } = require("node:crypto");
const { projection } = require("../gateway/catalog");
const AppError = require("../../../shared/errors/app-error");
const ids = new Set(projection.canonicalIds);
const bad = () => new AppError("Este plano precisa ser sincronizado ou revisado antes da sugestao.", 409, "ai_action_target_unavailable");

// Same prescription projection used by the local R2 command guard. No session/history writes.
function planSnapshot(plan, allowedIds = ids) {
  const exercises = new Map();
  const days = [...plan.days].sort((a, b) => a.order - b.order).map((day) => {
    const entries = [...day.exercises].sort((a, b) => a.order - b.order);
    const seen = new Set();
    if (!entries.length) throw bad();
    for (const e of entries) {
      if (!allowedIds.has(e.exerciseId) || seen.has(e.exerciseId)) throw bad();
      seen.add(e.exerciseId);
      const prescription = { id: e.exerciseId, series: e.sets, repeticoes: e.repsText || String(e.reps), descansoSegundos: e.restSeconds,
        rir: e.rir || "", cadencia: e.cadence || "", observacoesTreino: e.notes || "" };
      if (exercises.has(e.exerciseId) && JSON.stringify(exercises.get(e.exerciseId)) !== JSON.stringify(prescription)) throw bad();
      exercises.set(e.exerciseId, prescription);
    }
    return { codigo: day.name, nome: day.muscleGroup, ordem: day.order, exercicioIds: entries.map((e) => e.exerciseId) };
  });
  if (!days.length || exercises.size > 100 || days.length > 7) throw bad();
  return { id: plan.id, nome: plan.name, objetivo: plan.goal, nivel: plan.level, divisao: plan.split,
    diasPorSemana: plan.daysPerWeek, tempoEstimado: plan.estimatedMinutes,
    exercicios: [...exercises.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0), planoDias: days };
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonical(value[k])]));
  return value ?? null;
}
const digest = (value) => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
const include = { days: { orderBy: { order: "asc" }, include: { exercises: { orderBy: { order: "asc" } } } } };
async function loadSnapshot(client, userId, planId, allowedIds) {
  const plan = await client.workout.findFirst({ where: { id: planId, userId, deletedAt: null }, include });
  if (!plan) throw new AppError("Plano nao encontrado.", 404, "ai_action_target_not_found");
  return planSnapshot(plan, allowedIds);
}
function projectResult(before, proposal) {
  const next = structuredClone(before);
  const id = proposal.canonicalExerciseId;
  if (!ids.has(id)) throw new AppError("Exercicio sem identidade canonica.", 400, "ai_action_invalid_exercise");
  if (next.exercicios.some((e) => e.id === id)) throw bad();
  if (proposal.type === "REPLACE_EXERCISE") {
    const index = next.exercicios.findIndex((e) => e.id === proposal.previousExerciseId);
    if (index < 0) throw bad();
    next.exercicios[index] = { ...next.exercicios[index], id };
    for (const day of next.planoDias) day.exercicioIds = day.exercicioIds.map((e) => e === proposal.previousExerciseId ? id : e);
  } else {
    const day = next.planoDias.find((d) => d.ordem === proposal.dayOrder);
    if (!day) throw bad();
    next.exercicios.push({ id, series: proposal.sets, repeticoes: proposal.repetitions, descansoSegundos: proposal.restSeconds,
      rir: "", cadencia: "", observacoesTreino: "" });
    day.exercicioIds.push(id);
  }
  next.exercicios.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return next;
}
module.exports = { planSnapshot, loadSnapshot, projectResult, digest, include };
