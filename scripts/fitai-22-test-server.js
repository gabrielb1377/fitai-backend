const createApp = require("../src/app");
const { createAiRouter } = require("../src/modules/ai/routes/ai.routes");
const { createAiGateway } = require("../src/modules/ai/gateway/gateway");

const action = JSON.parse(process.env.FITAI_22_ACTION_JSON || "null");
if (!action || process.env.NODE_ENV !== "test") {
  throw new Error("FITAI-22 fixture server is restricted to NODE_ENV=test.");
}

const config = Object.freeze({
  provider: "openai",
  primaryModel: "fitai-test-fixture",
  fallbackModels: Object.freeze([]),
  apiKey: "local-fixture-only",
  maxAttempts: 1,
  timeoutMs: 1000,
  totalTimeoutMs: 1000,
  semanticFallbacks: 0,
});
const gateway = createAiGateway({
  config,
  logger: () => {},
  adapters: {
    openai: {
      async generate() {
        return {
          model: config.primaryModel,
          content: JSON.stringify({
            content: "Posso propor essa alteracao na ficha. Revise e confirme para aplicar.",
            actions: [action],
          }),
          finishReason: "completed",
          usage: { inputTokens: 1, outputTokens: 1 },
        };
      },
    },
  },
});
const app = createApp({ aiRoutes: createAiRouter({ chatGateway: gateway }) });
const server = app.listen(Number(process.env.PORT), "127.0.0.1");
server.on("error", (error) => {
  console.error("FITAI-22 fixture server failed to start.");
  process.exitCode = 1;
});
