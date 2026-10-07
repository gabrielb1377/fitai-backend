const projection = require("./catalog-projection.json");
const { gatewayError } = require("./errors");

function normalizeName(value) {
  // Match ExerciseIdentity.normalizeName v1, not broad transliteration/fuzzy matching.
  return String(value).toLowerCase().trim()
    .replace(/[\u00e1\u00e0\u00e2\u00e3\u00e4]/g, "a")
    .replace(/[\u00e9\u00e8\u00ea\u00eb]/g, "e")
    .replace(/[\u00ed\u00ec\u00ee\u00ef]/g, "i")
    .replace(/[\u00f3\u00f2\u00f4\u00f5\u00f6]/g, "o")
    .replace(/[\u00fa\u00f9\u00fb\u00fc]/g, "u").replace(/\u00e7/g, "c")
    .replace(/[_-]+/g, " ").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

function validateWorkoutCatalog(workout, requestId) {
  const dayIds = new Set();
  for (const day of workout.dias) {
    if (dayIds.has(day.id)) throw gatewayError("ai_domain_validation_error", requestId);
    dayIds.add(day.id);
    const seen = new Set();
    const occurrenceIds = new Set();
    for (const exercise of day.exercicios) {
      const name = normalizeName(exercise.nome);
      const id = Object.hasOwn(projection.nameBindings, name) ? projection.nameBindings[name] : null;
      if (!id || seen.has(id) || occurrenceIds.has(exercise.id)) throw gatewayError("ai_domain_validation_error", requestId);
      seen.add(id);
      occurrenceIds.add(exercise.id);
    }
  }
  for (const exercise of workout.exercicios) {
    if (!Object.hasOwn(projection.nameBindings, normalizeName(exercise.nome))) {
      throw gatewayError("ai_domain_validation_error", requestId);
    }
  }
  return workout;
}

function replacementCompatibility(previousId, replacementId) {
  const from = projection.exerciseMetadata?.[previousId];
  const to = projection.exerciseMetadata?.[replacementId];
  if (!from || !to || !from.primaryMuscles.length || !to.primaryMuscles.length) return "UNKNOWN";
  const muscles = new Set(from.primaryMuscles.map(normalizeName));
  const sharedMuscle = to.primaryMuscles.some((m) => muscles.has(normalizeName(m)));
  const sameCategory = normalizeName(from.category) === normalizeName(to.category);
  const distinctMovement = !["unknown", "isolation"].includes(from.movementPattern) &&
    !["unknown", "isolation"].includes(to.movementPattern) && from.movementPattern !== to.movementPattern;
  if ((!sharedMuscle && !sameCategory) || distinctMovement) return "INCOMPATIBLE";
  return sharedMuscle && !distinctMovement ? "COMPATIBLE" : "UNKNOWN";
}

module.exports = { projection, normalizeName, validateWorkoutCatalog, replacementCompatibility };
