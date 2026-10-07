const { randomUUID } = require("node:crypto");
const { memoryClient } = require("./chat.fixture");
const { createActionService } = require("../../src/modules/ai/actions/action.service");

const samplePlan = (owner = "a") => ({ id: `plan-${owner}`, userId: owner, deletedAt: null, name: "Upper A", goal: "strength", level: "intermediate",
  split: "AB", daysPerWeek: 2, estimatedMinutes: 45, days: [{ name: "A", muscleGroup: "Upper", order: 1,
    exercises: [{ exerciseId: "ombros_003", order: 1, sets: 3, reps: 10, repsText: "8-12", restSeconds: 90 }] }] });

function fixture() {
  const db = memoryClient(), rows = [], plans = [samplePlan()], active = [];
  const matches = (row, where = {}) => Object.entries(where).every(([key, value]) => {
    if (value && typeof value === "object" && value.in) return value.in.includes(row[key]);
    return row[key] === value;
  });
  const model = (items) => ({
    findFirst: async ({ where }) => structuredClone(items.find((r) => matches(r, where)) || null),
    findMany: async ({ where = {}, take = items.length }) => structuredClone(items.filter((r) => matches(r, where)).slice(0, take)),
    create: async ({ data }) => { const row = { expectedBefore: null, expectedAfter: null, executionDeviceId: null, resultReference: null, ...structuredClone(data) }; items.push(row); return structuredClone(row); },
    update: async ({ where, data }) => { const row = items.find((r) => matches(r, where)); Object.assign(row, structuredClone(data)); return structuredClone(row); }
  });
  db.client.aiActionProposal = model(rows); db.client.workout = model(plans); db.client.workoutSyncSession = model(active);
  db.client.aiUsage.findFirst = async ({ where }) => structuredClone(db.usages.find((r) => matches(r, where)) || null);
  const conversationId = randomUUID(), sourceMessageId = randomUUID();
  db.conversations.push({ id: conversationId, userId: "a" });
  db.messages.push({ id: sourceMessageId, conversationId, role: "assistant" });
  const service = createActionService({ client: db.client });
  const replace = { type: "REPLACE_EXERCISE", planId: "plan-a", previousExerciseId: "ombros_003", canonicalExerciseId: "ombros_004", reason: "Equipamento disponivel." };
  const propose = async (candidate = replace) => (await service.propose({ userId: "a", conversationId, sourceMessageId, candidates: [candidate] }))[0];
  return { ...db, rows, plans, active, service, replace, propose, conversationId, sourceMessageId };
}
module.exports = { fixture, samplePlan };
