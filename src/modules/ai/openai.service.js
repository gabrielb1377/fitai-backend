const OpenAI = require("openai");
const env = require("../../config/env");
const AppError = require("../../shared/errors/app-error");
const { buildWorkoutPrompt } = require("./prompt.builder");
const { parseWorkoutResponse } = require("./response.parser");

let openaiClient;

function isOpenAIEnabled() {
  return Boolean(env.openaiApiKey);
}

async function generateWorkoutWithOpenAI(input) {
  if (!isOpenAIEnabled()) {
    throw new AppError("OPENAI_API_KEY nao configurada.", 503, "openai_not_configured");
  }

  const prompt = buildWorkoutPrompt(input);
  const client = getOpenAIClient();

  console.info(`[ai] Gerando treino via OpenAI. model=${env.openaiModel}`);

  try {
    const response = await client.responses.create({
      model: env.openaiModel,
      instructions: prompt.instructions,
      input: prompt.input,
      text: {
        format: prompt.responseFormat
      },
      temperature: 0.4
    });

    console.info(`[ai] Resposta OpenAI recebida. request_id=${response._request_id || "indisponivel"}`);

    return parseWorkoutResponse(response);
  } catch (err) {
    if (err instanceof AppError) {
      throw err;
    }

    console.error(`[ai] Falha na OpenAI. ${formatOpenAIError(err)}`);
    throw new AppError(
      "Falha ao gerar treino com OpenAI.",
      502,
      "openai_generation_failed",
      buildOpenAIErrorDetails(err)
    );
  }
}

function getOpenAIClient() {
  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: env.openaiApiKey,
      timeout: env.openaiTimeoutMs,
      maxRetries: env.openaiMaxRetries
    });
  }

  return openaiClient;
}

function formatOpenAIError(err) {
  const status = err && err.status ? `status=${err.status}` : "status=sem_status";
  const name = err && err.name ? `name=${err.name}` : "name=erro";
  const requestId = err && err.request_id ? `request_id=${err.request_id}` : "request_id=indisponivel";

  return `${name} ${status} ${requestId}`;
}

function buildOpenAIErrorDetails(err) {
  return {
    name: err && err.name ? err.name : "OpenAIError",
    status: err && err.status ? err.status : null,
    requestId: err && err.request_id ? err.request_id : null
  };
}

module.exports = {
  isOpenAIEnabled,
  generateWorkoutWithOpenAI
};
