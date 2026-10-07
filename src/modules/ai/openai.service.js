const env = require("../../config/env");
const { createAiGateway } = require("./gateway/gateway");

// Compatibility entry point; transport and routing belong to the gateway.
const gateway = createAiGateway({ config: env.aiGateway });

function isOpenAIEnabled() {
  return Boolean(env.aiGateway.apiKey || env.aiGateway.explicitProvider);
}

async function generateWorkoutWithOpenAI(input, options = {}) {
  const result = await gateway.generate({ task: "generate_workout", input, requestId: options.requestId });
  return result.data;
}

module.exports = {
  isOpenAIEnabled,
  generateWorkoutWithOpenAI
};
