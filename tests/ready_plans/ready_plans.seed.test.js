const test = require("node:test");
const assert = require("node:assert/strict");
const { READY_PLANS, toPrismaPlan } = require("../../src/modules/ready_plans/ready_plans.seed");
const { READY_PLAN_CATEGORIES } = require("../../src/modules/ready_plans/ready_plans.schemas");

test("seed entrega 13 planos completos e cobre todas as categorias", () => {
  assert.equal(READY_PLANS.length, 13);
  assert.deepEqual(
    new Set(READY_PLANS.map((plan) => plan.category)),
    new Set(READY_PLAN_CATEGORIES)
  );

  for (const plan of READY_PLANS) {
    assert.equal(plan.days.length, plan.daysPerWeek);
    assert.ok(plan.coverImage);

    const prismaPlan = toPrismaPlan(plan);
    for (const day of prismaPlan.days.create) {
      assert.equal(day.exercises.create.length, 4);
      for (const exercise of day.exercises.create) {
        assert.ok(exercise.sets > 0);
        assert.ok(exercise.reps);
        assert.ok(exercise.restSeconds > 0);
      }
    }
  }
});
