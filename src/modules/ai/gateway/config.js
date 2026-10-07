function createAiConfig(values = process.env) {
  const provider = text(values.AI_PROVIDER) || "openai";
  if (!["openai", "openrouter"].includes(provider)) throw new Error("AI_PROVIDER invalido.");
  const primaryModel = model(text(values.AI_PRIMARY_MODEL) ||
    (provider === "openai" ? text(values.OPENAI_MODEL) || "gpt-4o-mini" : ""));
  const fallbackModels = [...new Set(text(values.AI_FALLBACK_MODELS).split(",")
    .map((value) => value.trim()).filter(Boolean).map(model))].filter((value) => value !== primaryModel);
  const apiKey = text(provider === "openrouter" ? values.OPENROUTER_API_KEY : values.OPENAI_API_KEY);
  return Object.freeze({
    provider, primaryModel, fallbackModels: Object.freeze(fallbackModels), apiKey,
    explicitProvider: Boolean(text(values.AI_PROVIDER)),
    timeoutMs: integer(values.AI_REQUEST_TIMEOUT_MS || values.OPENAI_TIMEOUT_MS, 30000, 1, 120000),
    totalTimeoutMs: integer(values.AI_TOTAL_TIMEOUT_MS, 18000, 1, 120000),
    maxAttempts: integer(values.AI_MAX_ATTEMPTS, 3, 1, 5),
    semanticFallbacks: integer(values.AI_SEMANTIC_FALLBACKS, 1, 0, 1)
  });
}

function text(value) { return typeof value === "string" ? value.trim() : ""; }
function model(value) {
  if (value && !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,159}$/.test(value)) {
    throw new Error("Modelo AI invalido.");
  }
  return value;
}
function integer(value, fallback, min, max) {
  const result = Number(text(value) || fallback);
  if (!Number.isInteger(result) || result < min || result > max) throw new Error("Limite AI invalido.");
  return result;
}

module.exports = { createAiConfig };
