const { normalizeName } = require("../gateway/catalog");

const KINDS = Object.freeze({ fact: "REGISTERED_FACT", metric: "DERIVED_METRIC", recommendation: "AI_RECOMMENDATION" });
const TYPES = Object.freeze({ weightKg: "weight", reps: "reps", steps: "steps", goal: "steps",
  totalXp: "xp", xp: "xp", distanceKm: "distance", paceSecondsPerKm: "pace", elapsedSeconds: "time",
  durationSeconds: "time", volumeKgReps: "volume", percentChange: "percent", weeklyXp: "xp",
  heartRate: "hr", elevationGain: "elevation", calories: "calories" });
const DERIVED = new Set(["pace", "volume", "percent", "xp"]);

/** Allowlisted typed evidence, never inferred physiological measurements. */
function collectEvidence(context = {}) {
  const facts = [];
  function visit(value, path, inherited = {}) {
    if (!value || typeof value !== "object" || ["EMPTY", "UNAVAILABLE"].includes(value.status)) return;
    const scope = { ...inherited, ...(value.exerciseId ? { exerciseId: value.exerciseId, name: value.name } : {}) };
    for (const [key, item] of Object.entries(value)) {
      const at = `${path}/${key}`;
      if (item && typeof item === "object") visit(item, at, scope);
      else if (Number.isFinite(item) && TYPES[key]) facts.push({ path: at, type: TYPES[key], value: item,
        kind: DERIVED.has(TYPES[key]) || /rolling\d+Days|windowBests|\/splits\//.test(at) ? KINDS.metric : KINDS.fact, ...scope });
      else if (key === "date" && typeof item === "string") facts.push({ path: at, type: "date", value: item.slice(0, 10), kind: KINDS.fact });
    }
  }
  for (const [key, domain] of Object.entries(context.domains || {})) {
    if (domain.status === "AVAILABLE") visit(domain.data, `/domains/${key}/data`);
  }
  return facts;
}

function readEvidencePath(context, pointer) {
  if (typeof pointer !== "string" || !pointer.startsWith("/domains/")) return undefined;
  let value = context;
  for (const part of pointer.slice(1).split("/")) {
    if (!value || ["UNAVAILABLE", "EMPTY"].includes(value.status) || !Object.hasOwn(value, part)) return undefined;
    value = value[part];
  }
  return value;
}

function isRecommendation(text) {
  return /\b(considere|sugestao|recomendacao|recomendo|pode considerar|poderia|talvez|sugiro|tente|consider|recommend|could|try)\b/.test(text);
}
function isUncertain(text) {
  return /\b(nao (tenho|ha|sei|posso afirmar)|sem (dados|evidencia|informacao)|indisponivel|desconhec|insuficien|faltam|nao esta disponivel|cannot determine|unavailable|not enough)\b/.test(text);
}

/** Recognized statements are deliberately limited to documented forms/units. */
function extractClaims(content) {
  const claims = [];
  const normalized = normalizeNameForText(content);
  const clauses = normalized.split(/(?<!\d)[.;!?]|[.;!?](?!\d)|\bmas\b|(?=\b(?:considere|recomendo|sugiro|tente|consider|recommend)\b)/).filter(Boolean);
  for (const clause of clauses) {
    const pastFact = /\b(seu ultimo|sua ultima|voce fez|foi|saldo|volume registrado|ultimo registro)\b/.test(clause);
    const kind = isRecommendation(clause) && !pastFact ? KINDS.recommendation : null;
    const number = /\b(\d+(?:[.,]\d+)?)\s*(kg|km|passos|steps|xp|reps|repeticoes|bpm|kcal|%|segundos|seconds|minutos|minutes)\b|\b(\d+(?:[.,]\d+)?)\s*%/g;
    for (const match of clause.matchAll(number)) {
      const unit = match[2] || "%", value = Number((match[1] || match[3]).replace(",", "."));
      const type = { kg: /volume/.test(clause) ? "volume" : "weight", km: "distance", passos: "steps", steps: "steps",
        xp: "xp", reps: "reps", repeticoes: "reps", bpm: "hr", kcal: "calories", "%": "percent",
        segundos: "time", seconds: "time", minutos: "time", minutes: "time" }[unit];
      claims.push({ clause, type, value: ["minutos", "minutes"].includes(unit) ? value * 60 : value,
        kind: kind || (DERIVED.has(type) || (type === "time" && /parcial|split/.test(clause)) || (type === "distance" && /total|acumulad|semana|mensal|janela/.test(clause)) ? KINDS.metric : KINDS.fact) });
    }
    for (const m of clause.matchAll(/\b(\d{1,2}):(\d{2})\s*(?:\/\s*km|por km)/g)) {
      claims.push({ clause, type: "pace", value: Number(m[1]) * 60 + Number(m[2]), kind: kind || KINDS.metric });
    }
    for (const m of clause.matchAll(/\b(\d{4}-\d{2}-\d{2})\b/g)) claims.push({ clause, type: "date", value: m[1], kind: KINDS.fact });
    for (const m of clause.matchAll(/\b(\d+(?:[.,]\d+)?)\s*kg\s*[x\u00d7]\s*(\d+)\b/g)) {
      claims.push({ clause, type: "set", value: { weight: Number(m[1].replace(",", ".")), reps: Number(m[2]) }, kind: kind || KINDS.fact });
    }
  }
  return claims;
}

function normalizeNameForText(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function matchingEvidence(claim, facts, question, bindings) {
  let candidates = facts.filter((f) => f.type === (claim.type === "set" ? "weight" : claim.type));
  if (["weight", "reps", "set"].includes(claim.type)) {
    const mentioned = new Set(Object.entries(bindings).filter(([name]) => name.length > 5 &&
      (` ${normalizeName(claim.clause)} `).includes(` ${name} `)).map(([, id]) => id));
    const inQuestion = new Set(Object.entries(bindings).filter(([name]) => name.length > 5 &&
      (` ${normalizeName(question)} `).includes(` ${name} `)).map(([, id]) => id));
    const selected = mentioned.size ? mentioned : inQuestion;
    if (selected.size === 1) candidates = candidates.filter((f) => selected.has(f.exerciseId));
    if (/ultimo|ultima|latest|last/.test(claim.clause)) candidates = candidates.filter((f) => f.path.includes("/recentFinalized/0/"));
  }
  if (["distance", "pace", "time"].includes(claim.type) && /ultima corrida|last run/.test(claim.clause)) {
    candidates = candidates.filter((f) => f.path.includes("/running/data/recent/0/"));
  }
  if (claim.type === "xp" && /semana|weekly/.test(claim.clause)) candidates = candidates.filter((f) => /weeklyXp/.test(f.path));
  else if (claim.type === "xp" && /saldo|total/.test(claim.clause)) candidates = candidates.filter((f) => /totalXp/.test(f.path));
  if (claim.type === "set") return candidates.find((f) => f.value === claim.value.weight &&
    facts.some((r) => r.path === f.path.replace(/weightKg$/, "reps") && r.value === claim.value.reps));
  return candidates.find((f) => typeof f.value === "number" ? Math.abs(f.value - claim.value) < 1e-8 : f.value === claim.value);
}

module.exports = { KINDS, collectEvidence, readEvidencePath, extractClaims, isRecommendation, isUncertain,
  normalizeNameForText, matchingEvidence };
