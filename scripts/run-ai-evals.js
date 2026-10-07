const { scenarios } = require("../tests/ai/semantic.fixture");
const { runSemanticScenarios } = require("../src/modules/ai/reliability/eval-harness");

async function main() {
  if (!process.argv.includes("--provider")) {
    const report = runSemanticScenarios(scenarios);
    console.info(JSON.stringify({ ...report, results: report.results.map((r) => ({ id: r.id, passed: r.passed,
      findings: r.evaluation.findings, faultProbeDetected: r.faultProbeDetected })) }, null, 2));
    if (report.failed || report.p0 || report.p1) process.exitCode = 1;
    return;
  }
  // Explicit double opt-in. Importing or running the local suite never calls a provider.
  if (process.env.AI_EVAL_ALLOW_EXTERNAL !== "1") throw new Error("Provider eval requires explicit AI_EVAL_ALLOW_EXTERNAL=1 authorization.");
  require("dotenv").config({ quiet: true });
  const { createAiConfig } = require("../src/modules/ai/gateway/config");
  const { createAiGateway } = require("../src/modules/ai/gateway/gateway");
  const { evaluateAiResponse } = require("../src/modules/ai/reliability/semantic-evaluator");
  const config = createAiConfig();
  if (!config.apiKey || !config.primaryModel) throw new Error("Provider configuration unavailable.");
  const gateway = createAiGateway({ config, logger: () => {} });
  const results = [];
  for (const s of scenarios) {
    try {
      const answer = await gateway.generate({ task: s.task, input: { message: s.question, context: s.context, actionContext: s.actionContext } });
      const { claims, ...evaluation } = evaluateAiResponse({ ...s, response: answer.data });
      results.push({ id: s.id, ...evaluation });
    } catch (error) { results.push({ id: s.id, passed: false, errorCode: error.code || "ai_eval_unavailable" }); }
  }
  console.info(JSON.stringify({ mode: "external_provider", syntheticDataOnly: true, results }, null, 2));
  if (results.some((r) => !r.passed)) process.exitCode = 1;
}
main().catch(() => { console.error("AI eval could not run. Check the explicit mode and local configuration."); process.exitCode = 1; });
