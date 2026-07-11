const test = require("node:test");
const assert = require("node:assert/strict");
const {
  listReadyPlans,
  getReadyPlanById,
  listReadyPlanCategories
} = require("../../src/modules/ready_plans/ready_plans.service");

test("listReadyPlans retorna apenas o resumo dos planos ativos", async () => {
  const result = await listReadyPlans({
    readyPlan: {
      findMany: async () => [{
        id: "plan-1",
        slug: "abc-classico",
        name: "ABC Clássico",
        description: "Plano fixo.",
        coverImage: "/images/ready-plans/abc-classico.jpg",
        category: "ABC",
        level: "Iniciante",
        goal: "Hipertrofia",
        split: "ABC",
        daysPerWeek: 3,
        estimatedMinutes: 55,
        _count: { days: 3 }
      }]
    }
  });

  assert.equal(result.plans.length, 1);
  assert.equal(result.plans[0].nome, "ABC Clássico");
  assert.equal(result.plans[0].totalDias, 3);
  assert.equal(result.plans[0].dias, undefined);
});

test("getReadyPlanById normaliza dias e exercícios para o contrato da biblioteca", async () => {
  const result = await getReadyPlanById("11111111-1111-4111-8111-111111111111", {
    readyPlan: {
      findFirst: async () => ({
        id: "plan-1",
        slug: "abc-classico",
        name: "ABC Clássico",
        description: "Plano fixo.",
        coverImage: "/images/ready-plans/abc-classico.jpg",
        category: "ABC",
        level: "Iniciante",
        goal: "Hipertrofia",
        split: "ABC",
        daysPerWeek: 3,
        estimatedMinutes: 55,
        days: [{
          id: "day-1",
          name: "Dia A",
          title: "Peito + Tríceps",
          weekday: "Segunda",
          muscleGroup: "Peito + Tríceps",
          order: 1,
          exercises: [{
            id: "exercise-1",
            name: "Supino reto com barra",
            category: "Peito",
            muscles: ["Peito", "Tríceps"],
            equipment: ["barra", "banco"],
            sets: 3,
            reps: "10-12",
            restSeconds: 75,
            order: 1
          }]
        }]
      })
    }
  });

  assert.equal(result.plan.dias[0].exercicios[0].series, 3);
  assert.equal(result.plan.dias[0].exercicios[0].repeticoes, "10-12");
  assert.equal(result.plan.dias[0].exercicios[0].descanso, 75);
});

test("listReadyPlanCategories preserva todas as categorias da biblioteca", async () => {
  const result = await listReadyPlanCategories({
    readyPlan: {
      groupBy: async () => [{ category: "ABC", _count: { _all: 2 } }]
    }
  });

  const abc = result.categories.find((category) => category.name === "ABC");
  const powerlifting = result.categories.find((category) => category.name === "Powerlifting");

  assert.equal(result.categories.length, 13);
  assert.equal(abc.planCount, 2);
  assert.equal(powerlifting.planCount, 0);
});
