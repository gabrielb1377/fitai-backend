const { randomUUID } = require("crypto");
const AppError = require("../../shared/errors/app-error");

const ALLOWED_CATEGORIES = [
  "progressao",
  "recuperacao",
  "frequencia",
  "recorde",
  "meta",
  "corrida",
  "equilibrio_muscular",
  "sugestao"
];

const ALLOWED_PRIORITIES = ["baixa", "media", "alta"];

function parseCoachResponse(response, options = {}) {
  const rawText = extractResponseText(response);
  const parsed = parseJson(rawText);
  const normalized = normalizeCoachResponse(parsed, options);

  if (!normalized.valid) {
    throw new AppError(
      "Resposta do Coach fora do formato esperado.",
      502,
      "invalid_coach_response",
      normalized.errors
    );
  }

  return normalized.data;
}

function normalizeCoachResponse(value, options = {}) {
  const now = options.now || new Date();
  const base = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const geradoEm = normalizeDate(base.geradoEm, now);
  const insights = Array.isArray(base.insights)
    ? base.insights.map((item) => normalizeInsight(item, geradoEm)).filter(Boolean).slice(0, 8)
    : [];
  const errors = [];

  if (!normalizeText(base.resumo, "")) {
    errors.push({ field: "resumo", message: "Resumo e obrigatorio." });
  }

  if (insights.length === 0) {
    errors.push({ field: "insights", message: "Ao menos um insight e obrigatorio." });
  }

  if (errors.length > 0) {
    return {
      valid: false,
      data: null,
      errors
    };
  }

  return {
    valid: true,
    data: {
      resumo: limit(normalizeText(base.resumo, "Analise FitIA gerada."), 220),
      insights,
      geradoEm
    },
    errors: []
  };
}

function normalizeInsight(value, generatedAt = new Date()) {
  const base = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const titulo = limit(normalizeText(base.titulo, ""), 80);
  const descricao = limit(normalizeText(base.descricao, ""), 180);
  const acao = limit(normalizeText(base.acao, ""), 120);

  if (!titulo || !descricao || !acao) {
    return null;
  }

  return {
    id: normalizeText(base.id, randomUUID()),
    categoria: normalizeCategory(base.categoria),
    prioridade: normalizePriority(base.prioridade),
    titulo,
    descricao,
    acao,
    exercicioId: normalizeNullableText(base.exercicioId),
    geradoEm: normalizeDate(base.geradoEm, generatedAt)
  };
}

function extractResponseText(response) {
  if (response && typeof response.output_text === "string" && response.output_text.trim()) {
    return response.output_text;
  }

  const textParts = [];
  const output = Array.isArray(response && response.output) ? response.output : [];

  output.forEach((item) => {
    const content = Array.isArray(item.content) ? item.content : [];

    content.forEach((part) => {
      if (typeof part.text === "string") {
        textParts.push(part.text);
      }
    });
  });

  const text = textParts.join("").trim();

  if (!text) {
    throw new AppError("Resposta vazia da OpenAI.", 502, "empty_coach_response");
  }

  return text;
}

function parseJson(rawText) {
  const text = stripJsonFence(rawText);

  try {
    return JSON.parse(text);
  } catch (err) {
    console.error("[coach] erro de parsing. reason=invalid_json");
    throw new AppError("Resposta do Coach nao e um JSON valido.", 502, "invalid_coach_json");
  }
}

function stripJsonFence(text) {
  return String(text || "")
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function normalizeCategory(value) {
  const category = normalizeKey(value);

  return ALLOWED_CATEGORIES.includes(category) ? category : "sugestao";
}

function normalizePriority(value) {
  const priority = normalizeKey(value);

  return ALLOWED_PRIORITIES.includes(priority) ? priority : "media";
}

function normalizeNullableText(value) {
  const text = normalizeText(value, "");

  return text || null;
}

function normalizeText(value, fallback) {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  return String(fallback || "").trim();
}

function normalizeDate(value, fallbackDate) {
  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) {
    return value;
  }

  if (typeof fallbackDate === "string" && !Number.isNaN(Date.parse(fallbackDate))) {
    return fallbackDate;
  }

  return fallbackDate.toISOString();
}

function normalizeKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function limit(value, maxLength) {
  const text = String(value || "").trim();

  if (text.length <= maxLength) {
    return text;
  }

  return text.slice(0, maxLength - 1).trimEnd() + ".";
}

module.exports = {
  ALLOWED_CATEGORIES,
  ALLOWED_PRIORITIES,
  parseCoachResponse,
  normalizeCoachResponse,
  parseJson,
  extractResponseText
};
