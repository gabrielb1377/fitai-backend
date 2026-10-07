require("dotenv").config({ quiet: true });
const { createAiConfig } = require("../src/modules/ai/gateway/config");

try {
  const config = createAiConfig();
  console.info(JSON.stringify({
    provider: config.provider, primaryConfigured: Boolean(config.primaryModel),
    credentialPresent: Boolean(config.apiKey), fallbackCount: config.fallbackModels.length,
    openaiCredentialPresent: Boolean(process.env.OPENAI_API_KEY?.trim()),
    openrouterCredentialPresent: Boolean(process.env.OPENROUTER_API_KEY?.trim()),
    timeoutMs: config.timeoutMs, totalTimeoutMs: config.totalTimeoutMs, maxAttempts: config.maxAttempts,
    externallyConfigured: Boolean(config.apiKey && config.primaryModel), networkRequests: 0
  }));
} catch {
  console.error("AI configuration invalid. Inspect backend environment privately.");
  process.exitCode = 1;
}
