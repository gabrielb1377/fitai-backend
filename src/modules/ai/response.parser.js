const AppError = require("../../shared/errors/app-error");
const { validateWorkoutResponse } = require("./workout.validator");

function parseWorkoutResponse(response) {
  const rawText = extractResponseText(response);
  const parsed = parseJson(rawText);
  const validation = validateWorkoutResponse(parsed);

  if (!validation.valid) {
    throw new AppError(
      "Resposta da IA fora do formato esperado.",
      502,
      "invalid_ai_response",
      validation.errors
    );
  }

  return validation.data;
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
    throw new AppError("Resposta vazia da OpenAI.", 502, "empty_ai_response");
  }

  return text;
}

function parseJson(rawText) {
  const text = stripJsonFence(rawText);

  try {
    return JSON.parse(text);
  } catch (err) {
    throw new AppError("Resposta da IA nao e um JSON valido.", 502, "invalid_ai_json");
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

module.exports = {
  parseWorkoutResponse,
  extractResponseText,
  parseJson
};
