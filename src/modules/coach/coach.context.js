const { createHash } = require("crypto");
const prisma = require("../../config/prisma");
const { verifyToken } = require("../auth/auth.service");

async function buildCoachContext(req, input) {
  const auth = readOptionalAuth(req);

  if (auth) {
    const dbContext = await tryBuildDatabaseContext(auth.userId, input);

    if (dbContext) {
      logContext(
        `usuario=autenticado treinos=${dbContext.raw.historicoTreinos.length} series=${dbContext.raw.historicoExercicios.length}`
      );
      return dbContext;
    }
  }

  const localContext = buildLocalContext(input);
  logContext(
    `usuario=anonimo treinos=${localContext.raw.historicoTreinos.length} series=${localContext.raw.historicoExercicios.length}`
  );

  return localContext;
}

async function tryBuildDatabaseContext(userId, input) {
  try {
    return await buildDatabaseContext(userId, input);
  } catch (err) {
    logContext(`contexto_db_indisponivel reason=${err && err.code ? err.code : "erro"}`);
    return null;
  }
}

async function buildDatabaseContext(userId, input) {
  const since = daysAgo(input.periodoDias);
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      profile: true,
      workouts: {
        select: {
          id: true,
          name: true,
          goal: true,
          level: true,
          split: true,
          daysPerWeek: true,
          estimatedMinutes: true,
          days: {
            select: {
              name: true,
              muscleGroup: true,
              order: true
            }
          }
        },
        take: 12,
        orderBy: { updatedAt: "desc" }
      },
      workoutHistories: {
        where: { startedAt: { gte: since } },
        select: {
          id: true,
          startedAt: true,
          finishedAt: true,
          totalVolume: true,
          totalSets: true,
          durationSeconds: true,
          workout: {
            select: {
              id: true,
              name: true,
              goal: true,
              split: true
            }
          }
        },
        orderBy: { startedAt: "desc" },
        take: 80
      },
      exerciseHistories: {
        where: {
          performedAt: { gte: since },
          ...(input.exercicioId ? { exerciseId: input.exercicioId } : {})
        },
        select: {
          id: true,
          exerciseId: true,
          weight: true,
          reps: true,
          sets: true,
          volume: true,
          performedAt: true,
          exercise: {
            select: {
              id: true,
              name: true,
              muscleGroup: true,
              equipment: true
            }
          }
        },
        orderBy: { performedAt: "desc" },
        take: 200
      },
      records: {
        select: {
          id: true,
          title: true,
          category: true,
          value: true,
          unit: true,
          achievedAt: true,
          exerciseId: true,
          exercise: {
            select: {
              name: true,
              muscleGroup: true
            }
          }
        },
        orderBy: { achievedAt: "desc" },
        take: 30
      },
      goals: {
        select: {
          id: true,
          title: true,
          category: true,
          currentValue: true,
          targetValue: true,
          status: true,
          updatedAt: true
        },
        orderBy: { updatedAt: "desc" },
        take: 30
      },
      runningHistories: {
        where: { performedAt: { gte: since } },
        select: {
          id: true,
          distanceKm: true,
          durationSeconds: true,
          averageSpeed: true,
          performedAt: true
        },
        orderBy: { performedAt: "desc" },
        take: 80
      }
    }
  });

  if (!user) return null;

  const raw = {
    perfil: profileFromDb(user.profile),
    planos: user.workouts.map((workout) => ({
      id: workout.id,
      nome: workout.name,
      objetivo: workout.goal,
      nivel: workout.level,
      divisao: workout.split,
      diasPorSemana: workout.daysPerWeek,
      tempoEstimado: workout.estimatedMinutes,
      grupos: workout.days.map((day) => day.muscleGroup).filter(Boolean)
    })),
    historicoTreinos: user.workoutHistories.map((history) => ({
      id: history.id,
      nomeTreino: history.workout ? history.workout.name : "Treino",
      objetivo: history.workout ? history.workout.goal : "",
      divisao: history.workout ? history.workout.split : "",
      dataHora: history.startedAt,
      tempoSegundos: history.durationSeconds,
      seriesConcluidas: history.totalSets,
      volumeTotal: history.totalVolume
    })),
    historicoExercicios: user.exerciseHistories.map((history) => ({
      id: history.id,
      exercicioId: history.exerciseId,
      nomeExercicio: history.exercise ? history.exercise.name : "Exercicio",
      grupoMuscular: history.exercise ? history.exercise.muscleGroup : "",
      equipamento: history.exercise ? history.exercise.equipment : "",
      peso: history.weight,
      repeticoes: history.reps,
      series: history.sets,
      volume: history.volume,
      dataHora: history.performedAt
    })),
    recordes: user.records.map((record) => ({
      id: record.id,
      titulo: record.title,
      categoria: record.category,
      valor: record.value,
      unidade: record.unit,
      data: record.achievedAt,
      exercicioId: record.exerciseId,
      exercicioNome: record.exercise ? record.exercise.name : null
    })),
    metas: user.goals.map((goal) => ({
      id: goal.id,
      titulo: goal.title,
      categoria: goal.category,
      valorAtual: goal.currentValue,
      valorObjetivo: goal.targetValue,
      status: goal.status,
      updatedAt: goal.updatedAt
    })),
    corridas: user.runningHistories.map((run) => ({
      id: run.id,
      distancia: run.distanceKm,
      segundos: run.durationSeconds,
      velocidadeMedia: run.averageSpeed,
      data: run.performedAt
    }))
  };

  return buildStructuredContext({
    source: "database",
    userKey: `user:${user.id}`,
    raw,
    input
  });
}

function buildLocalContext(input) {
  const contextoLocal = input.contextoLocal || {};
  const raw = {
    perfil: contextoLocal.perfil || {},
    planos: contextoLocal.planos || [],
    historicoTreinos: contextoLocal.historicoTreinos || [],
    historicoExercicios: contextoLocal.historicoExercicios || [],
    recordes: contextoLocal.recordes || [],
    metas: contextoLocal.metas || [],
    corridas: contextoLocal.corridas || []
  };
  const clientKey = input.clientId || hash(JSON.stringify(raw).slice(0, 1000));

  return buildStructuredContext({
    source: "local",
    userKey: `local:${clientKey}`,
    raw,
    input
  });
}

function buildStructuredContext({ source, userKey, raw, input }) {
  const analysis = analyzeContext(raw, input.periodoDias);

  return {
    source,
    userKey,
    raw,
    analysis,
    summary: {
      perfil: raw.perfil,
      planos: raw.planos.length,
      treinosConcluidos: raw.historicoTreinos.length,
      series: raw.historicoExercicios.length,
      recordes: raw.recordes.length,
      metas: raw.metas.length,
      corridas: raw.corridas.length,
      periodoDias: input.periodoDias,
      tipo: input.tipo,
      exercicioId: input.exercicioId
    }
  };
}

function analyzeContext(raw, periodoDias) {
  const now = new Date();
  const workouts = normalizeWorkouts(raw.historicoTreinos);
  const exerciseHistory = normalizeExerciseHistory(raw.historicoExercicios);
  const runs = normalizeRuns(raw.corridas);
  const goals = normalizeGoals(raw.metas);
  const muscleCounts = countMuscleGroups(workouts, exerciseHistory, raw.planos);
  const volume7 = volumeSince(workouts, exerciseHistory, 7, now);
  const volume14 = volumeSince(workouts, exerciseHistory, 14, now);
  const volume30 = volumeSince(workouts, exerciseHistory, 30, now);
  const previous14 = volumeBetween(workouts, exerciseHistory, 28, 14, now);
  const weeklyFrequency = frequencySince(workouts, 7, now);
  const daysSinceLastWorkout = daysSince(latestDate(workouts.map((item) => item.date)), now);
  const progression = progressionByExercise(exerciseHistory);
  const runningRecentDistance = distanceSince(runs, periodoDias, now);
  const runningPreviousDistance = distanceBetween(runs, periodoDias * 2, periodoDias, now);

  return {
    volume: {
      ultimos7Dias: volume7,
      ultimos14Dias: volume14,
      ultimos30Dias: volume30,
      queda14DiasPercentual: percentChange(volume14, previous14)
    },
    frequenciaSemanal: weeklyFrequency,
    diasDesdeUltimoTreino: daysSinceLastWorkout,
    gruposMusculares: {
      contagem: muscleCounts,
      subtreinados: undertrainedGroups(muscleCounts),
      excessivos: overtrainedGroups(muscleCounts)
    },
    progressaoCarga: progression,
    melhorCargaRecente: bestRecentLoad(exerciseHistory),
    quedaVolume: volume14 < previous14,
    sequenciaTreinos: workoutStreak(workouts, now),
    corrida: {
      distanciaRecente: runningRecentDistance,
      variacaoPercentual: percentChange(runningRecentDistance, runningPreviousDistance)
    },
    metas: goals.map((goal) => ({
      id: goal.id,
      titulo: goal.title,
      categoria: goal.category,
      progresso: goal.target > 0 ? round(goal.current / goal.target) : 0,
      faltante: Math.max(0, goal.target - goal.current),
      status: goal.status
    }))
  };
}

function readOptionalAuth(req) {
  const authHeader = req.headers.authorization || "";
  const [scheme, token] = authHeader.split(" ");

  if (scheme !== "Bearer" || !token) return null;

  try {
    const payload = verifyToken(token);
    return { userId: payload.sub, email: payload.email };
  } catch (err) {
    logContext("token opcional invalido; usando contexto local");
    return null;
  }
}

function profileFromDb(profile) {
  if (!profile) return {};

  return {
    peso: profile.weight,
    altura: profile.height,
    idade: profile.age,
    objetivo: profile.goal,
    nivel: profile.level
  };
}

function normalizeWorkouts(items) {
  return array(items).map((item) => ({
    id: text(item.id),
    name: text(item.nomeTreino || item.nome || item.name),
    goal: text(item.objetivo || item.goal),
    date: date(item.dataHora || item.startedAt || item.data),
    duration: integer(item.tempoSegundos || item.durationSeconds),
    sets: integer(item.seriesConcluidas || item.totalSets),
    volume: number(item.volumeTotal || item.totalVolume),
    records: integer(item.recordesBatidos)
  })).filter((item) => item.date);
}

function normalizeExerciseHistory(items) {
  return array(items).map((item) => ({
    id: text(item.id),
    exerciseId: text(item.exercicioId || item.exerciseId),
    name: text(item.nomeExercicio || item.exerciseName || item.nome),
    muscleGroup: text(item.grupoMuscular || item.muscleGroup || item.categoria),
    date: date(item.dataHora || item.performedAt || item.data),
    weight: number(item.peso || item.weight),
    reps: integer(item.repeticoes || item.reps),
    sets: integer(item.series || item.sets, 1),
    volume: number(item.volume)
  })).filter((item) => item.date);
}

function normalizeRuns(items) {
  return array(items).map((item) => ({
    id: text(item.id),
    distance: number(item.distancia || item.distanceKm),
    seconds: integer(item.segundos || item.durationSeconds),
    date: date(item.data || item.performedAt)
  })).filter((item) => item.date);
}

function normalizeGoals(items) {
  return array(items).map((item) => ({
    id: text(item.id),
    title: text(item.titulo || item.title),
    category: text(item.categoria || item.category),
    current: number(item.valorAtual || item.currentValue),
    target: number(item.valorObjetivo || item.targetValue),
    status: text(item.status)
  }));
}

function countMuscleGroups(workouts, exerciseHistory, plans) {
  const counts = {};
  const add = (value, amount = 1) => {
    const group = inferMuscleGroup(value);
    if (!group) return;
    counts[group] = (counts[group] || 0) + amount;
  };

  workouts.forEach((workout) => add(`${workout.name} ${workout.goal}`, 1));
  exerciseHistory.forEach((entry) => add(`${entry.muscleGroup} ${entry.name}`, entry.sets || 1));
  array(plans).forEach((plan) => {
    array(plan.grupos || plan.groups).forEach((group) => add(group, 0));
  });

  return counts;
}

function undertrainedGroups(counts) {
  const expected = ["peito", "costas", "pernas", "ombros", "bracos", "abdomen"];
  return expected.filter((group) => !counts[group] || counts[group] <= 1);
}

function overtrainedGroups(counts) {
  const values = Object.values(counts);
  if (values.length === 0) return [];
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Object.entries(counts)
    .filter(([, value]) => average > 0 && value >= average * 1.8 && value >= 4)
    .map(([group]) => group);
}

function volumeSince(workouts, exerciseHistory, days, now) {
  return volumeBetween(workouts, exerciseHistory, days, 0, now);
}

function volumeBetween(workouts, exerciseHistory, fromDays, toDays, now) {
  const from = new Date(now.getTime() - fromDays * 86400000);
  const to = new Date(now.getTime() - toDays * 86400000);
  const workoutVolume = workouts
    .filter((item) => item.date >= from && item.date < to)
    .reduce((sum, item) => sum + item.volume, 0);
  const exerciseVolume = exerciseHistory
    .filter((item) => item.date >= from && item.date < to)
    .reduce((sum, item) => sum + (item.volume || item.weight * item.reps * item.sets), 0);

  return round(exerciseVolume > 0 ? exerciseVolume : workoutVolume);
}

function frequencySince(workouts, days, now) {
  const from = new Date(now.getTime() - days * 86400000);
  return workouts.filter((item) => item.date >= from).length;
}

function progressionByExercise(exerciseHistory) {
  const groups = new Map();

  exerciseHistory.forEach((entry) => {
    const key = entry.exerciseId || normalizeKey(entry.name);
    if (!key) return;
    const current = groups.get(key) || [];
    current.push(entry);
    groups.set(key, current);
  });

  return Array.from(groups.values())
    .map((entries) => {
      entries.sort((a, b) => b.date - a.date);
      const latest = entries[0];
      const previous = entries[1];
      return {
        exercicioId: latest.exerciseId || null,
        exercicio: latest.name,
        melhorCargaRecente: Math.max(...entries.map((entry) => entry.weight || 0)),
        ultimaCarga: latest.weight,
        cargaAnterior: previous ? previous.weight : null,
        variacaoPercentual: previous && previous.weight > 0
          ? percentChange(latest.weight, previous.weight)
          : null,
        registros: entries.length
      };
    })
    .sort((a, b) => (b.melhorCargaRecente || 0) - (a.melhorCargaRecente || 0))
    .slice(0, 12);
}

function bestRecentLoad(exerciseHistory) {
  const weighted = exerciseHistory.filter((entry) => entry.weight > 0);
  if (weighted.length === 0) return null;
  weighted.sort((a, b) => b.weight - a.weight);
  const best = weighted[0];

  return {
    exercicioId: best.exerciseId || null,
    exercicio: best.name,
    carga: best.weight,
    repeticoes: best.reps,
    data: best.date
  };
}

function distanceSince(runs, days, now) {
  const from = new Date(now.getTime() - days * 86400000);
  return round(runs.filter((run) => run.date >= from).reduce((sum, run) => sum + run.distance, 0));
}

function distanceBetween(runs, fromDays, toDays, now) {
  const from = new Date(now.getTime() - fromDays * 86400000);
  const to = new Date(now.getTime() - toDays * 86400000);
  return round(runs.filter((run) => run.date >= from && run.date < to).reduce((sum, run) => sum + run.distance, 0));
}

function workoutStreak(workouts, now) {
  const days = new Set(workouts.map((workout) => dateKey(workout.date)));
  let current = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let streak = 0;

  while (days.has(dateKey(current))) {
    streak += 1;
    current = new Date(current.getTime() - 86400000);
  }

  return streak;
}

function latestDate(dates) {
  const valid = dates.filter(Boolean);
  if (valid.length === 0) return null;
  return valid.reduce((latest, current) => current > latest ? current : latest);
}

function daysSince(value, now) {
  if (!value) return null;
  return Math.max(0, Math.floor((dateOnly(now) - dateOnly(value)) / 86400000));
}

function inferMuscleGroup(value) {
  const textValue = normalizeKey(value);
  const entries = {
    peito: ["peito", "peitoral", "supino", "crucifixo", "flexao"],
    costas: ["costas", "dorso", "remada", "puxada", "barra fixa"],
    pernas: ["perna", "quadriceps", "posterior", "agachamento", "leg", "panturrilha", "gluteo"],
    ombros: ["ombro", "deltoide", "desenvolvimento", "elevacao"],
    bracos: ["biceps", "triceps", "rosca", "braco"],
    abdomen: ["abdomen", "abdominal", "core", "prancha"]
  };

  for (const [group, terms] of Object.entries(entries)) {
    if (terms.some((term) => textValue.includes(term))) return group;
  }

  return null;
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function text(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function number(value, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(String(value || "").replace(",", ".").replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function integer(value, fallback = 0) {
  return Math.round(number(value, fallback));
}

function date(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const parsed = Date.parse(String(value || ""));
  return Number.isNaN(parsed) ? null : new Date(parsed);
}

function dateOnly(value) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function dateKey(value) {
  if (!value) return "";
  const dateValue = dateOnly(value);
  return dateValue.toISOString().slice(0, 10);
}

function daysAgo(days) {
  return new Date(Date.now() - days * 86400000);
}

function percentChange(current, previous) {
  if (!previous || previous <= 0) return null;
  return round(((current - previous) / previous) * 100);
}

function round(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function normalizeKey(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function hash(value) {
  return createHash("sha1").update(String(value || "")).digest("hex").slice(0, 16);
}

function logContext(message) {
  if (process.env.NODE_ENV !== "production") {
    console.info(`[coach-context] ${message}`);
  }
}

module.exports = {
  buildCoachContext,
  analyzeContext
};
