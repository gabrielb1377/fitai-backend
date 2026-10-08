const { createHash } = require("crypto");
const prisma = require("../../config/prisma");
const AppError = require("../../shared/errors/app-error");

async function syncProfile(req, payload) {
  const user = await resolveAuthenticatedUser(req);
  const profile = payload.profile || payload.item || payload;
  const name = text(profile.nome || profile.name, user.name);

  if (name && name !== user.name) {
    await prisma.user.update({
      where: { id: user.id },
      data: { name }
    });
  }

  const syncedProfile = await prisma.profile.upsert({
    where: { userId: user.id },
    update: {
      weight: number(profile.peso || profile.weight),
      height: number(profile.altura || profile.height),
      age: integer(profile.idade || profile.age),
      goal: text(profile.objetivo || profile.goal, ""),
      level: text(profile.nivel || profile.level, "")
    },
    create: {
      userId: user.id,
      weight: number(profile.peso || profile.weight),
      height: number(profile.altura || profile.height),
      age: integer(profile.idade || profile.age),
      goal: text(profile.objetivo || profile.goal, ""),
      level: text(profile.nivel || profile.level, "")
    }
  });

  logSync("profile", user, 1);

  return {
    user: safeUser(user),
    profile: syncedProfile
  };
}

async function getProfile(req, payload = {}) {
  const user = await resolveAuthenticatedUser(req);
  const profile = await prisma.profile.findUnique({
    where: { userId: user.id }
  });

  return {
    user: safeUser(user),
    profile
  };
}

async function syncGoals(req, payload, items) {
  const user = await resolveAuthenticatedUser(req);
  const goals = [];

  for (const item of items) {
    const id = syncId(item, "goal", user.id);
    const data = {
      title: text(item.titulo || item.title, "Meta FitIA"),
      category: text(item.categoria || item.category, "geral"),
      currentValue: number(item.valorAtual || item.currentValue),
      targetValue: number(item.valorObjetivo || item.targetValue),
      status: text(item.status || item.statusLabel, "em_andamento")
    };

    await ensureOwnedOrAvailable(prisma, "goal", id, user.id);
    goals.push(await prisma.goal.upsert({
      where: { id },
      update: data,
      create: {
        id,
        userId: user.id,
        ...data
      }
    }));
  }

  logSync("goals", user, goals.length);

  return { goals };
}

async function getGoals(req, payload = {}) {
  const user = await resolveAuthenticatedUser(req);
  const goals = await prisma.goal.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: "desc" }
  });

  return { goals };
}

async function syncRecords(req, payload, items) {
  const user = await resolveAuthenticatedUser(req);
  const records = [];

  for (const item of items) {
    const id = syncId(item, "record", user.id);
    const data = {
      title: text(item.titulo || item.title, "Recorde FitIA"),
      category: text(item.categoria || item.category, "geral"),
      value: number(item.valor || item.value),
      unit: text(item.unidade || item.unit, ""),
      achievedAt: date(item.data || item.achievedAt)
    };

    await ensureOwnedOrAvailable(prisma, "record", id, user.id);
    records.push(await prisma.record.upsert({
      where: { id },
      update: data,
      create: {
        id,
        userId: user.id,
        ...data
      }
    }));
  }

  logSync("records", user, records.length);

  return { records };
}

async function getRecords(req, payload = {}) {
  const user = await resolveAuthenticatedUser(req);
  const records = await prisma.record.findMany({
    where: { userId: user.id },
    orderBy: { achievedAt: "desc" }
  });

  return { records };
}

async function syncWorkouts(req, payload, items) {
  const user = await resolveAuthenticatedUser(req);
  const workouts = [];

  for (const item of items) {
    const workout = await upsertWorkoutWithDays(user.id, item);
    workouts.push({ ...workout, deletionRevision: workout.deletionRevision?.toString() ?? null });
  }

  logSync("workouts", user, workouts.length);

  return { workouts };
}

async function getWorkouts(req, payload = {}) {
  const user = await resolveAuthenticatedUser(req);
  const workouts = await prisma.workout.findMany({
    where: { userId: user.id, deletedAt: null },
    include: {
      days: {
        orderBy: { order: "asc" },
        include: {
          exercises: {
            orderBy: { order: "asc" },
            include: { exercise: true }
          }
        }
      }
    },
    orderBy: { updatedAt: "desc" }
  });

  return { workouts };
}

/// Soft deletion is deliberate: completed history keeps its Workout relation,
/// while active plan reads and future sync pulls exclude the definition.
async function deleteWorkout(req, workoutId) {
  const user = await resolveAuthenticatedUser(req);
  return deleteWorkoutById(user.id, workoutId);
}

async function deleteWorkoutById(userId, workoutId, db = prisma) {
  const id = text(workoutId);
  if (!id) {
    throw new AppError("Identificador do plano obrigatorio.", 400, "workout_id_required");
  }

  const result = await db.$transaction(async (tx) => {
    await require("../activity_sync/activity_sync.service").lockUser(tx, userId);
    const revision = (await tx.$queryRaw`SELECT nextval('plan_deletion_revision_seq') AS revision`)[0].revision;
    return tx.workout.updateMany({
      where: { id, userId, deletedAt: null },
      data: { deletedAt: new Date(), deletionRevision: revision }
    });
  });

  return {
    id,
    deleted: result.count > 0,
    alreadyDeleted: result.count === 0
  };
}

async function syncWorkoutHistory(req, payload, items) {
  const user = await resolveAuthenticatedUser(req);
  const histories = [];

  for (const item of items) {
    histories.push(await upsertWorkoutHistory(user.id, item));
  }

  logSync("workout-history", user, histories.length);

  return { histories };
}

async function syncExerciseHistory(req, payload, items) {
  const user = await resolveAuthenticatedUser(req);
  const histories = [];

  for (const item of items) {
    histories.push(await upsertExerciseHistory(user.id, item));
  }

  logSync("exercise-history", user, histories.length);

  return { histories };
}

async function syncRunning(req, payload, items, db = prisma) {
  const user = await resolveAuthenticatedUser(req, db);
  const runs = [];

  for (const item of items) {
    const performedAt = date(item.data || item.performedAt);
    const distanceKm = number(item.distancia || item.distanceKm);
    const durationSeconds = integer(item.segundos || item.durationSeconds);
    const averageSpeed = number(
      item.velocidadeMedia || item.averageSpeed,
      durationSeconds > 0 ? distanceKm / (durationSeconds / 3600) : 0
    );
    const id = syncId(
      {
        id: item.id,
        data: performedAt.toISOString(),
        distancia: distanceKm,
        segundos: durationSeconds
      },
      "running",
      user.id
    );
    const data = {
      externalRunId: id,
      distanceKm,
      durationSeconds,
      averageSpeed,
      paceMinutesPerKm: distanceKm > 0 ? (durationSeconds / 60) / distanceKm : 0,
      route: Array.isArray(item.route) ? item.route : [],
      calories: optionalNumber(item.calories),
      steps: optionalInteger(item.steps || item.passos),
      startedAt: date(
        item.startTime || item.startedAt,
        new Date(performedAt.getTime() - durationSeconds * 1000)
      ),
      finishedAt: date(item.endTime || item.finishedAt, performedAt),
      performedAt
    };

    const stored = await db.$transaction(async (tx) => {
    await require("../activity_sync/activity_sync.service").lockUser(tx, user.id);
    const activityMutation = await tx.activitySyncMutation.findFirst({
      where: {
        userId: user.id,
        entityType: "run",
        entityKey: id
      }
    });
    if (activityMutation) {
      const canonical = await tx.runningHistory.findUnique({
        where: {
          userId_externalRunId: { userId: user.id, externalRunId: id }
        }
      });
      return canonical;
    }

    await ensureOwnedOrAvailable(tx, "runningHistory", id, user.id);
    return tx.runningHistory.upsert({
      where: { id },
      update: data,
      create: {
        id,
        userId: user.id,
        ...data
      }
    });
    });
    if (stored) runs.push(stored);
  }

  logSync("running", user, runs.length);

  return { runs: runs.map(toLegacyRunningDto) };
}

function toLegacyRunningDto(run) {
  if (!run) return run;
  const legacyRun = { ...run };
  delete legacyRun.revision;
  return legacyRun;
}

async function upsertWorkoutWithDays(userId, item) {
  const workoutId = syncId(item, "workout", userId);
  const exercises = Array.isArray(item.exercicios) ? item.exercicios : [];
  const days = Array.isArray(item.planoDias) ? item.planoDias : [];
  const source = text(item.origem || item.source, "manual");
  const readyPlanId = text(item.readyPlanId, "") || null;

  return prisma.$transaction(async (tx) => {
    await require("../activity_sync/activity_sync.service").lockUser(tx, userId);
    await ensureOwnedOrAvailable(tx, "workout", workoutId, userId);
    const existing = await tx.workout.findUnique({
      where: { id: workoutId },
      select: { deletedAt: true }
    });

    // A delayed upsert cannot revive a plan deleted by the same owner. There
    // is no restore endpoint in the current lifecycle contract.
    if (existing?.deletedAt) {
      return tx.workout.findUnique({ where: { id: workoutId } });
    }
    const workout = await tx.workout.upsert({
      where: { id: workoutId },
      update: {
        name: text(item.nome || item.name, "Treino FitIA"),
        description: text(item.descricao || item.description, ""),
        goal: text(item.objetivo || item.goal, "geral"),
        level: text(item.nivel || item.level, "iniciante"),
        split: text(item.divisao || item.split, "Full Body"),
        daysPerWeek: integer(item.diasPorSemana || item.daysPerWeek, days.length || 1),
        estimatedMinutes: integer(item.tempoEstimado || item.estimatedMinutes, 45),
        source,
        readyPlanId
      },
      create: {
        id: workoutId,
        userId,
        name: text(item.nome || item.name, "Treino FitIA"),
        description: text(item.descricao || item.description, ""),
        goal: text(item.objetivo || item.goal, "geral"),
        level: text(item.nivel || item.level, "iniciante"),
        split: text(item.divisao || item.split, "Full Body"),
        daysPerWeek: integer(item.diasPorSemana || item.daysPerWeek, days.length || 1),
        estimatedMinutes: integer(item.tempoEstimado || item.estimatedMinutes, 45),
        source,
        readyPlanId
      }
    });

    await tx.workoutDay.deleteMany({
      where: { workoutId }
    });

    const exerciseMap = new Map();
    for (const exercise of exercises) {
      const id = syncId(exercise, "exercise");
      const saved = await tx.exercise.upsert({
        where: { id },
        update: {
          name: text(exercise.nome || exercise.name, "Exercicio"),
          muscleGroup: text(exercise.categoria || exercise.muscleGroup, "Geral"),
          equipment: joinList(exercise.equipamentos || exercise.equipment),
          difficulty: text(exercise.dificuldade || exercise.difficulty || item.nivel, "iniciante"),
          gifKey: text(exercise.gifKey || exercise.gifPath || exercise.imagem, "")
        },
        create: {
          id,
          name: text(exercise.nome || exercise.name, "Exercicio"),
          muscleGroup: text(exercise.categoria || exercise.muscleGroup, "Geral"),
          equipment: joinList(exercise.equipamentos || exercise.equipment),
          difficulty: text(exercise.dificuldade || exercise.difficulty || item.nivel, "iniciante"),
          gifKey: text(exercise.gifKey || exercise.gifPath || exercise.imagem, "")
        }
      });

      exerciseMap.set(String(exercise.id || exercise.nome || saved.id), saved);
      exerciseMap.set(saved.id, saved);
      exerciseMap.set(saved.name, saved);
    }

    const sourceDays = days.length > 0
      ? days
      : [{
          codigo: "Dia 1",
          nome: text(item.nome, "Treino"),
          exercicioIds: exercises.map((exercise) => exercise.id || exercise.nome)
        }];

    for (let index = 0; index < sourceDays.length; index += 1) {
      const day = sourceDays[index];
      const workoutDay = await tx.workoutDay.create({
        data: {
          workoutId,
          name: text(day.codigo || day.name, `Dia ${index + 1}`),
          weekday: text(day.diaSemana || day.codigo || day.weekday, ""),
          muscleGroup: text(day.nome || day.muscleGroup, "Geral"),
          order: integer(day.ordem || day.order, index + 1)
        }
      });

      const ids = Array.isArray(day.exercicioIds) ? day.exercicioIds : [];
      const fallbackIds = ids.length > 0 ? ids : exercises.map((exercise) => exercise.id || exercise.nome);

      for (let exerciseIndex = 0; exerciseIndex < fallbackIds.length; exerciseIndex += 1) {
        const exercise = exerciseMap.get(String(fallbackIds[exerciseIndex]));
        if (!exercise) continue;

        const sourceExercise = exercises.find((item) => {
          const key = String(item.id || item.nome || item.name);
          return key === String(fallbackIds[exerciseIndex]) || item.nome === exercise.name || item.name === exercise.name;
        }) || {};
        const repsText = text(sourceExercise.repeticoes || sourceExercise.reps, "") || null;

        await tx.workoutDayExercise.create({
          data: {
            workoutDayId: workoutDay.id,
            exerciseId: exercise.id,
            order: exerciseIndex + 1,
            sets: integer(sourceExercise.series || sourceExercise.sets, 3),
            reps: integer(repsText, 12),
            repsText,
            restSeconds: integer(sourceExercise.descansoSegundos || sourceExercise.descanso || sourceExercise.restSeconds, 90),
            rir: text(sourceExercise.rir, "") || null,
            cadence: text(sourceExercise.cadencia || sourceExercise.cadence, "") || null,
            notes: text(sourceExercise.observacoesTreino || sourceExercise.observacoes || sourceExercise.notes, "") || null
          }
        });
      }
    }

    return workout;
  });
}

async function upsertWorkoutHistory(userId, item) {
  const workout = await ensureHistoryWorkout(userId, item);
  const startedAt = date(item.dataHora || item.startedAt);
  const durationSeconds = integer(item.tempoSegundos || item.durationSeconds);
  const finishedAt = date(
    item.finishedAt,
    new Date(startedAt.getTime() + Math.max(durationSeconds, 0) * 1000)
  );
  const id = syncId(item, "workout_history", userId);
  const data = {
    workoutId: workout.id,
    startedAt,
    finishedAt,
    totalVolume: number(item.volumeTotal || item.totalVolume),
    totalSets: integer(item.seriesConcluidas || item.totalSets),
    durationSeconds
  };

  await ensureOwnedOrAvailable(prisma, "workoutHistory", id, userId);
  return prisma.workoutHistory.upsert({
    where: { id },
    update: data,
    create: {
      id,
      userId,
      ...data
    }
  });
}

async function upsertExerciseHistory(userId, item) {
  return prisma.$transaction(async (tx) => {
    const workoutHistory = await ensureExerciseWorkoutHistory(tx, userId, item);
    const exerciseKey = text(item.exerciseKey, "");
    const exerciseName = text(item.nomeExercicio || item.exerciseName, "Exercicio");
    const exerciseId = syncId(
      { id: item.exercicioId || item.exerciseId, exerciseKey, exerciseName },
      "exercise"
    );
    const exercise = await tx.exercise.upsert({
      where: { id: exerciseId },
      update: {
        name: exerciseName,
        muscleGroup: text(item.categoria || item.muscleGroup, "Geral"),
        equipment: text(item.equipamento || item.equipment, ""),
        difficulty: text(item.dificuldade || item.difficulty, ""),
        gifKey: text(item.gifKey, "")
      },
      create: {
        id: exerciseId,
        name: exerciseName,
        muscleGroup: text(item.categoria || item.muscleGroup, "Geral"),
        equipment: text(item.equipamento || item.equipment, ""),
        difficulty: text(item.dificuldade || item.difficulty, ""),
        gifKey: text(item.gifKey, "")
      }
    });
    const id = syncId(item, "exercise_history", userId);
    const data = {
      exerciseId: exercise.id,
      exerciseKey,
      exerciseName,
      workoutHistoryId: workoutHistory.id,
      workoutSessionId: text(item.workoutSessionId || item.sessaoTreinoId, workoutHistory.id),
      setNumber: integer(item.serieNumero || item.setNumber, 1),
      completed: item.concluida !== false && item.completed !== false,
      weight: number(item.peso || item.weight),
      reps: integer(item.repeticoes || item.reps),
      sets: integer(item.series || item.sets, 1),
      restSeconds: integer(item.descansoSegundos || item.restSeconds) || null,
      rir: text(item.rir, "") || null,
      notes: text(item.comentario || item.notes, "") || null,
      volume: number(item.volume, number(item.peso || item.weight) * integer(item.repeticoes || item.reps)),
      performedAt: date(item.dataHora || item.performedAt)
    };

    await ensureOwnedOrAvailable(tx, "exerciseHistory", id, userId);
    return tx.exerciseHistory.upsert({
      where: { id },
      update: data,
      create: { id, userId, ...data }
    });
  });
}

async function ensureExerciseWorkoutHistory(tx, userId, item) {
  const workout = await ensureHistoryWorkout(userId, item, tx);
  const id = syncId(
    {
      id: item.workoutHistoryId || item.workoutSessionId || item.sessaoTreinoId,
      workoutId: item.treinoId || item.workoutId,
      performedAt: item.dataHora || item.performedAt,
      exerciseKey: item.exerciseKey
    },
    "workout_history",
    userId
  );
  const performedAt = date(item.dataHora || item.performedAt);
  await ensureOwnedOrAvailable(tx, "workoutHistory", id, userId);
  return tx.workoutHistory.upsert({
    where: { id },
    update: {
      workoutId: workout.id,
      startedAt: performedAt,
      finishedAt: performedAt,
      totalVolume: number(item.volume),
      totalSets: integer(item.series || item.sets, 1),
      durationSeconds: 0
    },
    create: {
      id,
      userId,
      workoutId: workout.id,
      startedAt: performedAt,
      finishedAt: performedAt,
      totalVolume: number(item.volume),
      totalSets: integer(item.series || item.sets, 1),
      durationSeconds: 0
    }
  });
}

async function ensureHistoryWorkout(userId, item, client = prisma) {
  const workoutId = text(item.treinoId || item.workoutId, "");

  if (workoutId) {
    const existing = await client.workout.findUnique({ where: { id: workoutId } });
    if (existing) {
      if (existing.userId !== userId) {
        throw ownershipNotFound();
      }
      return existing;
    }
  }

  const placeholderId = workoutId || `history_workout_${hash(`${userId}:${text(item.nomeTreino || item.workoutName, "Treino")}`)}`;

  await ensureOwnedOrAvailable(client, "workout", placeholderId, userId);

  return client.workout.upsert({
    where: { id: placeholderId },
    update: {
      name: text(item.nomeTreino || item.workoutName, "Treino"),
      description: "Treino criado automaticamente pela sincronizacao de historico.",
      goal: text(item.objetivo || item.goal, "geral"),
      level: text(item.nivel || item.level, "iniciante"),
      split: "Historico",
      daysPerWeek: 1,
      estimatedMinutes: Math.max(1, Math.round(integer(item.tempoSegundos || item.durationSeconds) / 60))
    },
    create: {
      id: placeholderId,
      userId,
      name: text(item.nomeTreino || item.workoutName, "Treino"),
      description: "Treino criado automaticamente pela sincronizacao de historico.",
      goal: text(item.objetivo || item.goal, "geral"),
      level: text(item.nivel || item.level, "iniciante"),
      split: "Historico",
      daysPerWeek: 1,
      estimatedMinutes: Math.max(1, Math.round(integer(item.tempoSegundos || item.durationSeconds) / 60))
    }
  });
}

async function resolveAuthenticatedUser(req, db = prisma) {
  const userId = text(req?.auth?.userId);

  if (!userId) {
    throw new AppError("Autenticacao obrigatoria.", 401, "authentication_required");
  }

  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new AppError("Usuario autenticado nao encontrado.", 401, "authenticated_user_not_found");
  }

  return user;
}

async function ensureOwnedOrAvailable(client, model, id, userId) {
  const existing = await client[model].findUnique({
    where: { id },
    select: { userId: true }
  });

  if (existing && existing.userId !== userId) {
    throw ownershipNotFound();
  }
}

function ownershipNotFound() {
  return new AppError("Recurso nao encontrado.", 404, "resource_not_found");
}

function safeUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
}

function syncId(item, prefix, ownerScope = "") {
  const explicit = text(item.id || item.syncId, "");
  if (explicit) return explicit;

  return `${prefix}_${hash(`${ownerScope}:${JSON.stringify(item || {})}`)}`;
}

function hash(value) {
  return createHash("sha1").update(String(value || "")).digest("hex").slice(0, 24);
}

function text(value, fallback = "") {
  const result = value === undefined || value === null ? "" : String(value).trim();
  return result || fallback;
}

function number(value, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;

  const parsed = Number(String(value || "").replace(",", ".").replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function integer(value, fallback = 0) {
  return Math.round(number(value, fallback));
}

function optionalNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  return number(value);
}

function optionalInteger(value) {
  if (value === undefined || value === null || value === "") return null;
  return integer(value);
}

function date(value, fallback = new Date()) {
  const parsed = Date.parse(String(value || ""));
  return Number.isNaN(parsed) ? fallback : new Date(parsed);
}

function joinList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => text(item)).filter(Boolean).join(", ");
  }

  return text(value);
}

function logSync(scope, user, count) {
  logRaw(`${scope} sincronizado count=${count} user=${user.id}`);
}

function logRaw(message) {
  if (process.env.NODE_ENV !== "production") {
    console.info(`[sync] ${message}`);
  }
}

module.exports = {
  syncProfile,
  getProfile,
  syncGoals,
  getGoals,
  syncRecords,
  getRecords,
  syncWorkouts,
  getWorkouts,
  deleteWorkout,
  deleteWorkoutById,
  syncWorkoutHistory,
  syncExerciseHistory,
  syncRunning
};
