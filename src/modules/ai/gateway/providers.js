const OpenAI = require("openai");
const { performance } = require("node:perf_hooks");

function createOpenAIAdapter(config, { client } = {}) {
  let sdk = client;
  return {
    async generate(request) {
      sdk ||= new OpenAI({ apiKey: config.apiKey, maxRetries: 0, timeout: config.timeoutMs, logLevel: "off" });
      const started = performance.now();
      const response = await sdk.responses.create({
        model: request.model,
        input: request.messages,
        text: { format: request.responseFormat },
        store: false
      }, { signal: request.signal, timeout: request.timeoutMs, maxRetries: 0 });
      const content = response.output_text || (response.output || []).flatMap((item) => item.content || [])
        .map((part) => part.text || "").join("");
      return normalized("openai", response.model, content, response.usage,
        response.status, performance.now() - started, response._request_id || response.id);
    }
  };
}

function createOpenRouterAdapter(config, { fetchImpl = fetch } = {}) {
  return {
    async generate(request) {
      const started = performance.now();
      const { type, ...jsonSchema } = request.responseFormat;
      const response = await fetchImpl("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        signal: request.signal,
        headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: request.model, messages: request.messages, stream: false,
          response_format: { type, json_schema: jsonSchema },
          provider: { require_parameters: true, allow_fallbacks: false, data_collection: "deny" }
        })
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw Object.assign(new Error("Provider request failed."), { status: response.status });
      }
      let payload;
      try { payload = await response.json(); }
      catch { throw Object.assign(new Error("Invalid provider envelope."), { name: "InvalidProviderResponse" }); }
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw Object.assign(new Error("Invalid provider envelope."), { name: "InvalidProviderResponse" });
      }
      // OpenRouter can report a provider error inside an HTTP 200 envelope.
      if (payload.error) throw Object.assign(new Error("Provider response failed."), { status: payload.error.code });
      const choice = payload.choices?.[0];
      return normalized("openrouter", payload.model, choice?.message?.content || "", payload.usage,
        choice?.finish_reason, performance.now() - started, payload.id);
    }
  };
}

function normalized(provider, model, content, usage, finishReason, latencyMs, requestId) {
  let structuredPayload = null;
  try { structuredPayload = JSON.parse(content); } catch { /* Gateway owns semantic validation. */ }
  return {
    provider, model, content, structuredPayload,
    usage: { inputTokens: usage?.input_tokens ?? usage?.prompt_tokens ?? null,
      outputTokens: usage?.output_tokens ?? usage?.completion_tokens ?? null },
    finishReason: finishReason || null, latencyMs, requestId: requestId || null
  };
}

module.exports = { createOpenAIAdapter, createOpenRouterAdapter };
