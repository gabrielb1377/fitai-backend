const prisma = require("../../config/prisma");
const AppError = require("../../shared/errors/app-error");
const { READY_PLAN_CATEGORIES } = require("./ready_plans.schemas");

async function listReadyPlans(db = prisma) {
  const plans = await db.readyPlan.findMany({
    where: { isActive: true },
    orderBy: [{ category: "asc" }, { name: "asc" }],
    include: { _count: { select: { days: true } } }
  });

  return { plans: plans.map(toSummaryDto) };
}

async function getReadyPlanById(id, db = prisma) {
  const plan = await db.readyPlan.findFirst({
    where: { id, isActive: true },
    include: {
      days: {
        orderBy: { order: "asc" },
        include: { exercises: { orderBy: { order: "asc" } } }
      }
    }
  });

  if (!plan) {
    throw new AppError("Plano pronto nao encontrado.", 404, "ready_plan_not_found");
  }

  return { plan: toDetailDto(plan) };
}

async function listReadyPlanCategories(db = prisma) {
  const totals = await db.readyPlan.groupBy({
    by: ["category"],
    where: { isActive: true },
    _count: { _all: true }
  });
  const countByCategory = new Map(totals.map((item) => [item.category, item._count._all]));

  return {
    categories: READY_PLAN_CATEGORIES.map((name) => ({
      id: slugify(name),
      name,
      planCount: countByCategory.get(name) || 0
    }))
  };
}

function toSummaryDto(plan) {
  return {
    id: plan.id,
    slug: plan.slug,
    nome: plan.name,
    descricao: plan.description,
    capa: plan.coverImage,
    categoria: plan.category,
    nivel: plan.level,
    objetivo: plan.goal,
    divisao: plan.split,
    diasPorSemana: plan.daysPerWeek,
    tempoEstimado: plan.estimatedMinutes,
    totalDias: plan._count ? plan._count.days : undefined
  };
}

function toDetailDto(plan) {
  return {
    ...toSummaryDto(plan),
    dias: plan.days.map((day) => ({
      id: day.id,
      nome: day.name,
      titulo: day.title,
      diaSemana: day.weekday,
      grupoMuscular: day.muscleGroup,
      ordem: day.order,
      exercicios: day.exercises.map((exercise) => ({
        id: exercise.id,
        nome: exercise.name,
        categoria: exercise.category,
        musculos: exercise.muscles,
        equipamentos: exercise.equipment,
        series: exercise.sets,
        repeticoes: exercise.reps,
        descanso: exercise.restSeconds,
        ordem: exercise.order
      }))
    }))
  };
}

function slugify(value) {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

module.exports = {
  listReadyPlans,
  getReadyPlanById,
  listReadyPlanCategories,
  toSummaryDto,
  toDetailDto
};
