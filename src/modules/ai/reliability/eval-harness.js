const { CATEGORIES, VERSION, evaluateAiResponse } = require("./semantic-evaluator");

/** Checks reference responses and deliberate fault probes independently. */
function runSemanticScenarios(scenarios) {
  const results = scenarios.map((s) => {
    const evaluation = evaluateAiResponse(s);
    const negative = evaluateAiResponse({ ...s, response: s.negative });
    const negativeDetected = s.expectedNegativeWarning ? negative.findings.some((f) => f.code === s.expectedNegativeWarning) :
      !negative.passed && negative.findings.some((f) => f.code === s.expectedCode);
    return { id: s.id, categories: s.categories, passed: evaluation.passed && negativeDetected,
      evaluation, faultProbeDetected: negativeDetected };
  });
  const byCategory = Object.fromEntries(CATEGORIES.map((key) => {
    const relevant = results.filter((r) => r.categories.includes(key));
    return [key, { scenarios: relevant.length, passed: relevant.filter((r) => r.passed).length,
      failed: relevant.filter((r) => !r.passed).length }];
  }));
  return { contractVersion: VERSION, mode: "deterministic_local", total: results.length,
    passed: results.filter((r) => r.passed).length, failed: results.filter((r) => !r.passed).length,
    p0: results.reduce((n, r) => n + r.evaluation.p0, 0), p1: results.reduce((n, r) => n + r.evaluation.p1, 0),
    warnings: results.reduce((n, r) => n + r.evaluation.warnings, 0), byCategory, results };
}
module.exports = { runSemanticScenarios };
