const test = require("node:test");
const assert = require("node:assert/strict");
const { createFitnessContextEngine, BUDGET } = require("../../src/modules/ai/chat/fitness-context.engine");
const { buildChatPrompt } = require("../../src/modules/ai/chat/chat.prompt");
const { projectSplits } = require("../../src/modules/ai/chat/running-context");
const now = new Date("2026-10-07T12:00:00Z");
function fixture({ empty = false, failSteps = false } = {}) {
  const queries = [];
  const query = (source, result) => async (args) => { queries.push({ source, args }); return typeof result === "function" ? result(args) : result; };
  const route = [{ latitude: -12.9, longitude: -38.5, cumulativeDistanceKm: 0, activeElapsedSeconds: 0, timestamp: "2026-10-07T11:00:00Z" },
    { latitude: -12.8, longitude: -38.4, cumulativeDistanceKm: 1, activeElapsedSeconds: 300, timestamp: "2026-10-07T11:05:00Z" }];
  const client = {
    profile: { findUnique: query("profile", ({ where }) => empty ? null : { goal: where.userId === "a" ? "forca" : "corrida", level: "iniciante", email: "private@fitia.test" }) },
    goal: { findMany: query("goals", []) },
    workout: { findMany: query("plans", empty ? [] : [{ goal: "forca", split: "AB", daysPerWeek: 3, estimatedMinutes: 45 }]) },
    workoutSyncSession: { findMany: query("strength", empty ? [] : [{ startedAt: new Date(+now - 3600000), finishedAt: now,
      sets: [{ exerciseId: "peito_001", weight: 20, reps: 10, setIndex: 0 }], _count: { sets: 1 } }]) },
    progressionXpEvent: { aggregate: query("xp", { _sum: { xpAwarded: empty ? null : 25 }, _count: empty ? 0 : 2 }),
      findMany: query("xpEvents", empty ? [] : [{ sourceType: "workout", xpAwarded: 15, occurredAt: now }]) },
    runningHistory: { findMany: query("running", empty ? [] : [{ distanceKm: 1, durationSeconds: 300, averageSpeed: 12, finishedAt: now, route }]) },
    dailySteps: { findMany: query("steps", () => { if (failSteps) throw new Error("private_db_failure");
      return empty ? [] : [{ dayKey: "2026-10-07", steps: 6000, goal: 5000, rawHealth: { secret: "RAW_HEALTH" }, deviceId: "private-device" }]; }) }
  };
  return { client, queries, engine: createFitnessContextEngine({ client, now: () => now }) };
}
test("AI-CTX-01 context reads only authenticated owner", async () => {
  const h = fixture(); const c = await h.engine.build({ userId: "a", task: "chat" });
  assert.equal(c.domains.profile.data.fitnessGoal, "forca");
  for (const { args } of h.queries) assert.equal(args.where.userId, "a");
});
test("AI-CTX-02 B context cannot contain A data; no caller context bypass", async () => {
  const h = fixture(); const c = await h.engine.build({ userId: "b", task: "chat" });
  assert.equal(c.domains.profile.data.fitnessGoal, "corrida");
  assert.ok(h.queries.every((q) => q.args.where.userId === "b"));
  await assert.rejects(h.engine.build({ task: "chat" }), { code: "unauthorized" });
});
test("AI-CTX-03 / AI-PRIV-01 running metrics and splits exclude GPS", async () => {
  const h = fixture(); const c = await h.engine.build({ userId: "a", task: "running_advice" });
  const run = c.domains.running.data.recent[0]; assert.equal(run.splits[0].elapsedSeconds, 300);
  assert.equal(c.domains.running.data.windowBests.best1kSeconds, 300); assert.equal(Object.hasOwn(c.domains.running.data.windowBests, "best5kSeconds"), false);
  const prompt = JSON.stringify(buildChatPrompt({ context: c, message: "Corrida?" }));
  assert.doesNotMatch(prompt, /latitude|longitude|-12.9|-38.5|\broute\b/);
});
test("AI-CTX-04 / AI-PRIV-02 canonical steps exclude raw Health", async () => {
  const h = fixture(); const c = await h.engine.build({ userId: "a", task: "analyze_progress" });
  assert.equal(c.domains.steps.data.recentDays[0].steps, 6000); assert.equal(c.domains.steps.data.today.status, "UNAVAILABLE");
  assert.doesNotMatch(JSON.stringify(c), /RAW_HEALTH|deviceId|rawHealth/);
});
test("AI-CTX-05 strength selects finalized canonical sessions, volume and performance", async () => {
  const h = fixture(); const c = await h.engine.build({ userId: "a", task: "analyze_progress" });
  const q = h.queries.find((x) => x.source === "strength"); assert.equal(q.args.where.status, "completed");
  assert.equal(c.domains.strength.data.recentFinalized[0].volumeKgReps, 200);
  assert.equal(c.domains.strength.data.recentFinalized[0].performance[0].exerciseId, "peito_001");
  assert.equal(c.domains.strength.data.progression.status, "UNAVAILABLE");
});
test("AI-CTX-06 progression consumes canonical server balance", async () => {
  const c = await fixture().engine.build({ userId: "a", task: "chat" });
  assert.equal(c.domains.progression.data.totalXp, 25); assert.equal(c.domains.progression.data.currentLevel, 1);
  assert.equal(c.domains.progression.data.events[0].xp, 15);
});
test("AI-CTX-07 missing/unavailable domains are explicit, not fabricated", async () => {
  const c = await fixture({ empty: true, failSteps: true }).engine.build({ userId: "a", task: "chat" });
  assert.equal(c.domains.profile.status, "EMPTY"); assert.equal(c.domains.running.status, "EMPTY");
  assert.equal(c.domains.steps.status, "UNAVAILABLE"); assert.doesNotMatch(JSON.stringify(c), /private_db_failure/);
});
test("AI-CTX-08 budgets at query and serialized boundaries", async () => {
  const h = fixture(); const c = await h.engine.build({ userId: "a", task: "chat" });
  assert.equal(h.queries.find((q) => q.source === "running").args.take, BUDGET.runs);
  assert.equal(h.queries.find((q) => q.source === "strength").args.take, BUDGET.workouts);
  assert.ok(Buffer.byteLength(JSON.stringify(c)) <= BUDGET.bytes);
});
test("AI-CTX-09 task selection does not read unrelated domains", async () => {
  const h = fixture(); const c = await h.engine.build({ userId: "a", task: "running_advice" });
  assert.equal(Object.hasOwn(c.domains, "strength"), false); assert.equal(Object.hasOwn(c.domains, "steps"), false);
  assert.ok(h.queries.every((q) => !["strength", "steps", "plans"].includes(q.source)));
});
test("AI-CTX-08 adversarial oversized source omits domains instead of cutting JSON", async () => {
  const h = fixture();
  h.client.workoutSyncSession.findMany = async () => Array.from({ length: 20 }, () => ({
    startedAt: new Date(+now - 3600000), finishedAt: now, _count: { sets: 48 },
    sets: Array.from({ length: 48 }, (_, i) => ({ exerciseId: "peito_001", weight: 20, reps: 10, setIndex: i }))
  }));
  h.client.runningHistory.findMany = async () => Array.from({ length: 20 }, () => ({ distanceKm: 12, durationSeconds: 3600,
    averageSpeed: 12, finishedAt: now, route: Array.from({ length: 13 }, (_, km) => ({ cumulativeDistanceKm: km,
      activeElapsedSeconds: km * 300, timestamp: new Date(+now - (12 - km) * 300000).toISOString() })) }));
  const context = await h.engine.build({ userId: "a", task: "analyze_progress" });
  assert.ok(Buffer.byteLength(JSON.stringify(context)) <= BUDGET.bytes);
  assert.ok(Object.values(context.domains).some((d) => d.reason === "context_budget_exceeded"));
  assert.equal(JSON.parse(JSON.stringify(context)).contractVersion, "FitnessContext/v1");
});
test("AI-CTX-10 deterministic field order and query ordering", async () => {
  const h = fixture(), a = await h.engine.build({ userId: "a", task: "chat" }), b = await h.engine.build({ userId: "a", task: "chat" });
  assert.deepEqual(a, b);
  for (const q of h.queries.filter((q) => q.args.take)) assert.ok(q.args.orderBy);
});
test("AI-PRIV-04 automatic context excludes email and auth metadata", async () => {
  const c = await fixture().engine.build({ userId: "a", task: "chat" });
  assert.doesNotMatch(JSON.stringify(c), /private@|email|password|token|userId/);
});
test("AI context malformed/legacy route never fabricates splits", () => {
  assert.equal(projectSplits({ distanceKm: 5, durationSeconds: 1000, route: [{ latitude: 1 }, { latitude: 2 }] }), null);
});
