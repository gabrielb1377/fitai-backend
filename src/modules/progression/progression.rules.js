const ACTIONS = Object.freeze({
  INCREASE_WEIGHT: "increase_weight",
  INCREASE_REPS: "increase_reps",
  MAINTAIN: "maintain",
  REDUCE_WEIGHT: "reduce_weight",
  DELOAD: "deload",
  INSUFFICIENT_DATA: "insufficient_data"
});

function calculateExerciseProgression({ exercise, config = {}, sessions = [] }) {
  const recent = Array.isArray(sessions) ? sessions.slice(0, 6) : [];
  const range = normalizeRange(config.repRange, config.goal);
  const sets = clampInt(config.sets, 2, 4, 3);
  const restSeconds = clampInt(config.restSeconds, 30, 180, 60);
  const latest = recent[0];
  const currentWeight = latest ? bestWeight(latest) : 0;
  const confidence = recent.length >= 4 ? "high" : recent.length >= 2 ? "medium" : "low";
  const base = (overrides) => ({
    exerciseId: String(exercise.id || ""),
    exerciseKey: String(exercise.key || exercise.id || exercise.name || "unknown"),
    exerciseName: String(exercise.name || "Exercicio"),
    currentWeight,
    currentSets: sets,
    currentRepRange: `${range.min}-${range.max}`,
    currentRestSeconds: restSeconds,
    suggestedWeight: currentWeight,
    suggestedSets: sets,
    suggestedRepRange: `${range.min}-${range.max}`,
    suggestedRestSeconds: restSeconds,
    confidence,
    basedOnSessions: recent.length,
    generatedAt: new Date().toISOString(),
    ...overrides
  });

  if (recent.length === 0) {
    return base({
      action: ACTIONS.INSUFFICIENT_DATA,
      reason: "Registre de 3 a 6 sessoes para receber uma sugestao segura."
    });
  }

  const below = (session) => isBelowMinimum(session, range.min);
  if (recent.length >= 3 && recent.slice(0, 3).every(below)) {
    return base({
      action: ACTIONS.DELOAD,
      suggestedWeight: roundWeight(currentWeight * 0.9),
      suggestedSets: Math.max(2, sets - 1),
      suggestedRestSeconds: safeRest(exercise, restSeconds, true),
      reason: "As tres ultimas sessoes ficaram abaixo da faixa alvo. Reduza o esforco e priorize tecnica."
    });
  }

  if (recent.length >= 2 && below(recent[0]) && below(recent[1])) {
    return base({
      action: ACTIONS.REDUCE_WEIGHT,
      suggestedWeight: roundWeight(currentWeight * 0.95),
      suggestedRestSeconds: safeRest(exercise, restSeconds, true),
      reason: "As duas ultimas sessoes ficaram abaixo da faixa alvo. Uma reducao leve pode recuperar consistencia."
    });
  }

  if (recent.length >= 2 && currentWeight > 0 && reachedMaximum(recent[0], range.max) && reachedMaximum(recent[1], range.max)) {
    return base({
      action: ACTIONS.INCREASE_WEIGHT,
      suggestedWeight: roundWeight(currentWeight + loadIncrement(exercise, currentWeight)),
      suggestedRepRange: `${range.min}-${range.max - 1}`,
      suggestedRestSeconds: safeRest(exercise, restSeconds),
      reason: "Voce atingiu o topo da faixa em duas sessoes. Aumente apenas a carga na proxima execucao."
    });
  }

  if (withinRange(recent[0], range)) {
    const nextMax = Math.min(range.max, bestReps(recent[0]) + 1);
    return base({
      action: ACTIONS.INCREASE_REPS,
      suggestedRepRange: `${range.min}-${nextMax}`,
      reason: "A ultima execucao ficou consistente na faixa alvo. Busque uma repeticao a mais antes de subir a carga."
    });
  }

  return base({
    action: ACTIONS.MAINTAIN,
    reason: "Mantenha a configuracao atual e registre mais sessoes para uma recomendacao mais confiavel."
  });
}

function normalizeRange(value, goal = "") {
  const match = /([0-9]+)\s*[-–]\s*([0-9]+)/.exec(String(value || ""));
  if (match && Number(match[1]) > 0 && Number(match[2]) >= Number(match[1])) {
    return { min: Number(match[1]), max: Number(match[2]) };
  }
  const normalized = String(goal).toLowerCase();
  if (normalized.includes("forca")) return { min: 4, max: 6 };
  if (normalized.includes("resist")) return { min: 10, max: 15 };
  return { min: 6, max: 12 };
}

function sessionSets(session) {
  return Array.isArray(session && session.sets) ? session.sets : [];
}

function bestWeight(session) {
  return sessionSets(session).reduce((max, item) => Math.max(max, Number(item.weight || item.peso || 0)), 0);
}

function bestReps(session) {
  return sessionSets(session).reduce((max, item) => Math.max(max, Number(item.reps || item.repeticoes || 0)), 0);
}

function isBelowMinimum(session, minimum) {
  const sets = sessionSets(session).filter((item) => Number(item.reps || item.repeticoes || 0) > 0);
  return sets.length === 0 || sets.filter((item) => Number(item.reps || item.repeticoes || 0) < minimum).length * 2 >= sets.length;
}

function reachedMaximum(session, maximum) {
  const sets = sessionSets(session);
  return sets.length > 0 && sets.every((item) => Number(item.reps || item.repeticoes || 0) >= maximum);
}

function withinRange(session, range) {
  const sets = sessionSets(session);
  return sets.length > 0 && sets.every((item) => {
    const reps = Number(item.reps || item.repeticoes || 0);
    return reps >= range.min && reps <= range.max;
  });
}

function loadIncrement(exercise, currentWeight) {
  const equipment = Array.isArray(exercise.equipment) ? exercise.equipment.join(" ").toLowerCase() : "";
  const base = equipment.includes("maquina") || equipment.includes("machine") ? 5 : 2;
  return Math.min(Math.max(currentWeight * 0.025, base), currentWeight * 0.1);
}

function safeRest(exercise, configured, performanceLow = false) {
  if (performanceLow) return Math.max(60, configured);
  const compound = /supino|agach|remada|levantamento|barra/.test(String(exercise.name || "").toLowerCase());
  return compound ? Math.max(90, configured) : Math.min(120, configured);
}

function roundWeight(value) {
  return value <= 0 ? 0 : Math.round(value * 2) / 2;
}

function clampInt(value, min, max, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.round(parsed))) : fallback;
}

module.exports = { ACTIONS, calculateExerciseProgression };
