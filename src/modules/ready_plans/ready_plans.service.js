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

async function listReadyPlanFavorites(userId, db = prisma) {
  const favorites = await db.readyPlanFavorite.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: {
      readyPlan: {
        include: { _count: { select: { days: true } } }
      }
    }
  });

  return {
    favoriteIds: favorites.map((favorite) => favorite.readyPlanId),
    favorites: favorites
      .filter((favorite) => favorite.readyPlan.isActive)
      .map((favorite) => toSummaryDto(favorite.readyPlan))
  };
}

async function addReadyPlanFavorite(userId, readyPlanId, db = prisma) {
  const readyPlan = await db.readyPlan.findFirst({
    where: { id: readyPlanId, isActive: true },
    select: { id: true }
  });

  if (!readyPlan) {
    throw new AppError("Plano pronto nao encontrado.", 404, "ready_plan_not_found");
  }

  const favorite = await db.readyPlanFavorite.upsert({
    where: { userId_readyPlanId: { userId, readyPlanId } },
    update: {},
    create: { userId, readyPlanId }
  });

  return { message: "Plano adicionado aos favoritos.", favorite };
}

async function removeReadyPlanFavorite(userId, readyPlanId, db = prisma) {
  await db.readyPlanFavorite.deleteMany({ where: { userId, readyPlanId } });
  return { message: "Plano removido dos favoritos.", readyPlanId };
}

async function copyReadyPlan(req, id, db = prisma) {
  const user = await resolveCopyUser(req, db);
  const idempotencyKey = text(req.headers["idempotency-key"]);

  try {
    const workout = await db.$transaction(async (tx) => {
      const readyPlan = await tx.readyPlan.findFirst({
        where: { id, isActive: true },
        include: {
          days: {
            orderBy: { order: "asc" },
            include: { exercises: { orderBy: { order: "asc" } } }
          }
        }
      });

      if (!readyPlan) {
        throw new AppError("Plano pronto nao encontrado.", 404, "ready_plan_not_found");
      }

      const existing = await tx.workout.findFirst({
        where: { userId: user.id, readyPlanId: readyPlan.id },
        select: { id: true, deletedAt: true }
      });

      if (existing && !existing.deletedAt) {
        throw new AppError("Este plano ja foi adicionado aos seus planos.", 409, "ready_plan_already_copied");
      }

      if (existing?.deletedAt) {
        await tx.workoutDay.deleteMany({ where: { workoutId: existing.id } });
      }

      const workoutData = {
          userId: user.id,
          name: readyPlan.name,
          description: readyPlan.description,
          goal: readyPlan.goal,
          level: readyPlan.level,
          split: readyPlan.split,
          daysPerWeek: readyPlan.daysPerWeek,
          estimatedMinutes: readyPlan.estimatedMinutes,
          source: "ready_plan",
          readyPlanId: readyPlan.id
      };
      const workout = existing
        ? await tx.workout.update({
            where: { id: existing.id },
            data: { ...workoutData, deletedAt: null }
          })
        : await tx.workout.create({ data: workoutData });
      const exercisesByName = new Map();

      for (const day of readyPlan.days) {
        const workoutDay = await tx.workoutDay.create({
          data: {
            workoutId: workout.id,
            name: day.name,
            weekday: text(day.weekday, day.name),
            muscleGroup: day.muscleGroup,
            order: day.order
          }
        });

        for (const readyExercise of day.exercises) {
          const exercise = await findOrCreateExercise(tx, readyExercise, readyPlan.level, exercisesByName);

          await tx.workoutDayExercise.create({
            data: {
              workoutDayId: workoutDay.id,
              exerciseId: exercise.id,
              order: readyExercise.order,
              sets: readyExercise.sets,
              reps: repsAsNumber(readyExercise.reps),
              repsText: readyExercise.reps,
              restSeconds: readyExercise.restSeconds,
              rir: readyExercise.rir,
              cadence: readyExercise.cadence,
              notes: readyExercise.notes
            }
          });
        }
      }

      await tx.readyPlan.update({
        where: { id: readyPlan.id },
        data: { popularityCount: { increment: 1 } }
      });

      return tx.workout.findUnique({
        where: { id: workout.id },
        include: workoutInclude
      });
    });

    logReadyPlans(`copy user=${user.id} readyPlan=${id} idempotency=${idempotencyKey ? "provided" : "generated"}`);
    return {
      message: "Plano adicionado com sucesso.",
      plan: toCopiedPlanDto(workout)
    };
  } catch (error) {
    if (error && error.code === "P2002") {
      throw new AppError("Este plano ja foi adicionado aos seus planos.", 409, "ready_plan_already_copied");
    }

    throw error;
  }
}

const workoutInclude = {
  days: {
    orderBy: { order: "asc" },
    include: {
      exercises: {
        orderBy: { order: "asc" },
        include: { exercise: true }
      }
    }
  }
};

async function findOrCreateExercise(tx, readyExercise, level, cache) {
  const key = readyExercise.name.trim().toLowerCase();
  const cached = cache.get(key);
  if (cached) return cached;

  const existing = await tx.exercise.findFirst({
    where: { name: readyExercise.name },
    orderBy: { createdAt: "asc" }
  });
  const exercise = existing || await tx.exercise.create({
    data: {
      name: readyExercise.name,
      muscleGroup: readyExercise.category,
      equipment: readyExercise.equipment.join(", "),
      difficulty: level,
      gifKey: ""
    }
  });

  cache.set(key, exercise);
  return exercise;
}

async function resolveCopyUser(req, db) {
  const userId = text(req.auth?.userId);
  if (!userId) {
    throw new AppError("Token JWT nao informado.", 401, "missing_token");
  }

  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new AppError("Usuario autenticado nao encontrado.", 401, "authenticated_user_not_found");
  }
  return user;
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
    featured: plan.featured,
    popularityCount: plan.popularityCount,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
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
        rir: exercise.rir,
        cadencia: exercise.cadence,
        observacoes: exercise.notes,
        ordem: exercise.order
      }))
    }))
  };
}

function toCopiedPlanDto(workout) {
  return {
    id: workout.id,
    nome: workout.name,
    descricao: workout.description,
    objetivo: workout.goal,
    nivel: workout.level,
    divisao: workout.split,
    diasPorSemana: workout.daysPerWeek,
    tempoEstimado: workout.estimatedMinutes,
    source: workout.source,
    readyPlanId: workout.readyPlanId,
    dias: workout.days.map((day) => ({
      id: day.id,
      nome: day.name,
      diaSemana: day.weekday,
      grupoMuscular: day.muscleGroup,
      ordem: day.order,
      exercicios: day.exercises.map((item) => ({
        id: item.id,
        exerciseId: item.exerciseId,
        nome: item.exercise.name,
        series: item.sets,
        repeticoes: item.repsText || String(item.reps),
        descanso: item.restSeconds,
        rir: item.rir,
        cadencia: item.cadence,
        observacoes: item.notes,
        ordem: item.order
      }))
    }))
  };
}

function repsAsNumber(value) {
  const match = String(value || "").match(/\d+/);
  return match ? Number(match[0]) : 0;
}

function text(value, fallback = "") {
  const result = value === undefined || value === null ? "" : String(value).trim();
  return result || fallback;
}

function logReadyPlans(message) {
  if (process.env.NODE_ENV !== "production") {
    console.info(`[ready-plans] ${message}`);
  }
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
  listReadyPlanFavorites,
  addReadyPlanFavorite,
  removeReadyPlanFavorite,
  copyReadyPlan,
  toSummaryDto,
  toDetailDto,
  toCopiedPlanDto,
  repsAsNumber
};
