const { randomUUID } = require("node:crypto");
const { performance } = require("node:perf_hooks");
const { buildWorkoutPrompt } = require("../prompt.builder");
const { parseWorkoutResponse } = require("../response.parser");
const { validateWorkoutCatalog, projection } = require("./catalog");
const { gatewayError, classifyProviderError, policies } = require("./errors");
const { createOpenAIAdapter, createOpenRouterAdapter } = require("./providers");
const { buildChatPrompt, parseChatResponse } = require("../chat/chat.prompt");
const { evaluateAiResponse } = require("../reliability/semantic-evaluator");

const TASKS = Object.freeze({
  generate_workout: "implemented",
  chat: "implemented", analyze_progress: "implemented", replace_exercise: "reserved", running_advice: "implemented"
});

function createAiGateway({ config, adapters, logger = (event) => console.info(JSON.stringify(event)), now = () => performance.now() }) {
  const providerAdapters = adapters || {
    openai: createOpenAIAdapter(config), openrouter: createOpenRouterAdapter(config)
  };
  return {
    async generate({ task = "generate_workout", input, requestId = randomUUID() }) {
      // Only server-generated UUIDs may enter the correlation/log boundary.
      const correlation = /^[0-9a-f-]{36}$/i.test(requestId) ? requestId : randomUUID();
      const started = now();
      let attempts = 0;
      let semanticFallbacks = 0;
      let inputTokens = null;
      let outputTokens = null;
      let servedModel = null;
      function emit(status, code = null) {
        const event = Object.freeze({ event: "ai_gateway", requestId: correlation, taskType: Object.hasOwn(TASKS, task) ? task : "unsupported",
          provider: config.provider, policy: task === "generate_workout" ? "workout-v1" : "chat-v1", servedModel,
          fallbackUsed: attempts > 1, attemptCount: attempts, latencyMs: Math.max(0, Math.round(now() - started)),
          inputTokens, outputTokens, estimatedCost: "unavailable", status, errorCategory: code });
        // Logging is best-effort; it must never replay a paid generation.
        try { logger(event); } catch { /* Telemetry failure cannot change the domain result. */ }
        return event;
      }
      try {
        if (TASKS[task] !== "implemented") throw gatewayError("ai_unsupported_task", correlation);
        if (!config.apiKey || !config.primaryModel || !providerAdapters[config.provider]) {
          throw gatewayError("ai_not_configured", correlation);
        }
        const isWorkout = task === "generate_workout";
        const prompt = isWorkout ? buildWorkoutPrompt(input) : buildChatPrompt(input);
        const allowedNames = Object.keys(projection.nameBindings);
        const messages = isWorkout ? [
          { role: "system", content: prompt.instructions },
          { role: "user", content: `${prompt.input}\nNomes permitidos pelo catalogo canonico (use literalmente):\n${JSON.stringify(allowedNames)}` }
        ] : prompt.messages;
        const routes = [config.primaryModel, ...config.fallbackModels].slice(0, config.maxAttempts);
        let lastError;
        for (const [index, model] of routes.entries()) {
          const remaining = config.totalTimeoutMs - (now() - started);
          if (remaining <= 0) throw gatewayError("ai_provider_timeout", correlation);
          // Reserve part of the end-to-end deadline for each remaining route.
          const timeoutMs = Math.max(1, Math.floor(Math.min(config.timeoutMs, remaining / (routes.length - index))));
          attempts += 1;
          let response;
          try {
            response = await withDeadline((signal) => providerAdapters[config.provider].generate({
              task, model, messages, responseFormat: prompt.responseFormat, timeoutMs, signal
            }), timeoutMs);
          } catch (error) {
            const code = error?.name === "InvalidProviderResponse" ? "ai_invalid_response" : classifyProviderError(error);
            lastError = gatewayError(code, correlation);
            if (code === "ai_invalid_response") {
              if (semanticFallbacks++ < config.semanticFallbacks) continue;
            } else if (policies[code]?.[1]) continue;
            throw lastError;
          }
          if (!response || typeof response !== "object") response = { content: "" };
          servedModel = safeServedModel(response.model, model);
          inputTokens = sumUsage(inputTokens, response.usage?.inputTokens);
          outputTokens = sumUsage(outputTokens, response.usage?.outputTokens);
          try {
            if (![null, undefined, "stop", "completed"].includes(response.finishReason)) {
              throw gatewayError("ai_invalid_response", correlation);
            }
            const workout = isWorkout ? parseWorkoutResponse({ output_text: response.content }, input) : parseChatResponse(response.content, correlation);
            if (JSON.stringify(workout).includes(config.apiKey)) {
              throw gatewayError("ai_invalid_response", correlation);
            }
            if (isWorkout) validateWorkoutCatalog(workout, correlation);
            else if (!evaluateAiResponse({ question: input.message, task, context: input.context, response: workout, evaluateActions: false }).passed) {
              throw gatewayError("ai_semantic_validation_error", correlation);
            }
            return { data: workout, metadata: emit("succeeded") };
          } catch (error) {
            if (error.code === "ai_domain_validation_error") throw error;
            lastError = gatewayError(error.code === "ai_semantic_validation_error" ? error.code : "ai_invalid_response", correlation);
            if (semanticFallbacks++ >= config.semanticFallbacks) throw lastError;
          }
        }
        throw lastError || gatewayError("ai_provider_unavailable", correlation);
      } catch (error) {
        const safeError = gatewayError(policies[error.code] ? error.code : "ai_provider_rejected", correlation);
        emit("failed", safeError.code);
        throw safeError;
      }
    }
  };
}

async function withDeadline(operation, timeoutMs) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(Object.assign(new Error("AI deadline exceeded."), { name: "TimeoutError" })); }, timeoutMs);
  });
  try { return await Promise.race([operation(controller.signal), timeout]); }
  finally { clearTimeout(timer); }
}

function safeServedModel(value, requested) {
  // Provider metadata is untrusted: never allow it to smuggle content into logs.
  return typeof value === "string" && (value === requested ||
    (value.startsWith(`${requested}-`) && /^\d{4}-?\d{2}-?\d{2}$/.test(value.slice(requested.length + 1)))) ? value : null;
}
function sumUsage(current, next) {
  return Number.isSafeInteger(next) && next >= 0 ? (current || 0) + next : current;
}

module.exports = { createAiGateway, TASKS, withDeadline };
