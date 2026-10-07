const AppError = require("../../../shared/errors/app-error");

const policies = Object.freeze({
  ai_provider_timeout: [504, true, "O servico de IA excedeu o tempo de resposta."],
  ai_provider_rate_limited: [503, true, "O servico de IA esta ocupado. Tente novamente depois."],
  ai_provider_unavailable: [503, true, "O servico de IA esta indisponivel."],
  ai_provider_auth_error: [503, false, "O servico de IA nao esta disponivel neste ambiente."],
  ai_provider_rejected: [502, false, "O servico de IA nao pode atender esta solicitacao."],
  ai_invalid_response: [502, false, "A IA nao retornou um treino valido."],
  ai_domain_validation_error: [502, false, "O treino gerado nao passou na validacao."],
  ai_semantic_validation_error: [502, false, "Nao foi possivel apoiar esta resposta nos dados disponiveis. Tente reformular a pergunta."],
  ai_not_configured: [503, false, "A geracao de IA nao esta configurada neste ambiente."],
  ai_unsupported_task: [400, false, "Esta tarefa de IA ainda nao esta disponivel."]
});

function gatewayError(code, requestId) {
  const [status, retryable, message] = policies[code] || policies.ai_provider_unavailable;
  const error = new AppError(message, status, policies[code] ? code : "ai_provider_unavailable");
  error.retryable = retryable;
  error.requestId = requestId;
  return error;
}

function classifyProviderError(error) {
  const status = Number(error?.status);
  if (status === 401 || status === 403) return "ai_provider_auth_error";
  if (status === 429) return "ai_provider_rate_limited";
  if ([500, 502, 503, 504].includes(status)) return "ai_provider_unavailable";
  if (["AbortError", "TimeoutError", "APIConnectionTimeoutError"].includes(error?.name)) return "ai_provider_timeout";
  if (error?.name === "APIConnectionError" || error?.name === "TypeError" ||
      ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN"].includes(error?.code)) {
    return error?.code === "ETIMEDOUT" ? "ai_provider_timeout" : "ai_provider_unavailable";
  }
  return "ai_provider_rejected";
}

module.exports = { gatewayError, classifyProviderError, policies };
