const test = require("node:test");
const assert = require("node:assert/strict");
const { copyReadyPlan } = require("../../src/modules/ready_plans/ready_plans.service");

test("copiar template restaura somente a instancia soft-deleted do mesmo usuario", async () => {
  const calls = [];
  const restored = {
    id: "workout-deleted",
    name: "ABC Classico",
    description: "Plano pronto.",
    goal: "Hipertrofia",
    level: "Iniciante",
    split: "ABC",
    daysPerWeek: 3,
    estimatedMinutes: 55,
    source: "ready_plan",
    readyPlanId: "ready-abc",
    days: []
  };
  const transaction = {
    readyPlan: {
      findFirst: async () => ({
        id: "ready-abc",
        name: "ABC Classico",
        description: "Plano pronto.",
        goal: "Hipertrofia",
        level: "Iniciante",
        split: "ABC",
        daysPerWeek: 3,
        estimatedMinutes: 55,
        days: []
      }),
      update: async () => ({})
    },
    workout: {
      findFirst: async () => ({ id: "workout-deleted", deletedAt: new Date() }),
      update: async (args) => {
        calls.push(args);
        return restored;
      },
      findUnique: async () => restored
    },
    workoutDay: {
      deleteMany: async (args) => calls.push(args)
    }
  };
  const db = {
    user: { findUnique: async () => ({ id: "user-a" }) },
    $transaction: async (callback) => callback(transaction)
  };

  const result = await copyReadyPlan(
    { auth: { userId: "user-a" }, headers: {} },
    "ready-abc",
    db
  );

  assert.equal(result.plan.id, "workout-deleted");
  assert.deepEqual(calls[0], { where: { workoutId: "workout-deleted" } });
  assert.equal(calls[1].data.deletedAt, null);
  assert.equal(calls[1].where.id, "workout-deleted");
});
