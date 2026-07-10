const prisma = require("../../config/prisma");
const { verifyToken } = require("../auth/auth.service");

async function loadWorkoutContext(req, input) {
  const auth = readOptionalAuth(req);

  if (!auth) {
    logContext("usuario=anonimo contexto=formulario");
    return buildAnonymousContext(input);
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: auth.userId },
      select: {
        id: true,
        name: true,
        profile: {
          select: {
            weight: true,
            height: true,
            age: true,
            goal: true,
            level: true
          }
        },
        goals: {
          select: {
            title: true,
            category: true,
            currentValue: true,
            targetValue: true,
            status: true
          },
          orderBy: { updatedAt: "desc" },
          take: 5
        },
        records: {
          select: {
            title: true,
            category: true,
            value: true,
            unit: true,
            achievedAt: true,
            exercise: {
              select: {
                name: true,
                muscleGroup: true
              }
            }
          },
          orderBy: { achievedAt: "desc" },
          take: 10
        },
        workouts: {
          select: {
            name: true,
            goal: true,
            level: true,
            split: true,
            daysPerWeek: true,
            estimatedMinutes: true,
            createdAt: true
          },
          orderBy: { createdAt: "desc" },
          take: 5
        },
        workoutHistories: {
          select: {
            startedAt: true,
            finishedAt: true,
            totalVolume: true,
            totalSets: true,
            durationSeconds: true,
            workout: {
              select: {
                name: true,
                goal: true,
                split: true
              }
            }
          },
          orderBy: { startedAt: "desc" },
          take: 10
        },
        exerciseHistories: {
          select: {
            weight: true,
            reps: true,
            sets: true,
            volume: true,
            performedAt: true,
            exercise: {
              select: {
                name: true,
                muscleGroup: true,
                equipment: true
              }
            }
          },
          orderBy: { performedAt: "desc" },
          take: 30
        },
        runningHistories: {
          select: {
            distanceKm: true,
            durationSeconds: true,
            averageSpeed: true,
            performedAt: true
          },
          orderBy: { performedAt: "desc" },
          take: 5
        }
      }
    });

    if (!user) {
      logContext("usuario=anonimo reason=usuario_nao_encontrado");
      return buildAnonymousContext(input);
    }

    const context = buildAuthenticatedContext(user, input);
    logContext(
      `usuario=autenticado contexto=carregado metas=${context.metas.length} recordes=${context.recordes.length} historicos=${context.historicoTreinos.recentes.length}`
    );

    return context;
  } catch (err) {
    logContext(`usuario=anonimo reason=contexto_indisponivel code=${err.code || "db_error"}`);
    return buildAnonymousContext(input);
  }
}

function readOptionalAuth(req) {
  const authHeader = req.headers.authorization || "";
  const [scheme, token] = authHeader.split(" ");

  if (scheme !== "Bearer" || !token) {
    return null;
  }

  try {
    const payload = verifyToken(token);

    return {
      userId: payload.sub,
      email: payload.email
    };
  } catch (err) {
    logContext("usuario=anonimo reason=token_opcional_invalido");
    return null;
  }
}

function buildAnonymousContext(input) {
  return {
    autenticado: false,
    origem: "formulario",
    perfil: {
      objetivo: input.objetivo,
      nivel: input.nivel
    },
    metas: [],
    recordes: [],
    historicoTreinos: {
      frequenciaRecente: 0,
      recentes: []
    },
    historicoExercicios: {
      favoritos: [],
      recentes: []
    },
    corrida: [],
    preferencias: buildFormPreferences(input)
  };
}

function buildAuthenticatedContext(user, input) {
  const workoutFrequency = calculateRecentFrequency(user.workoutHistories);
  const favoriteExercises = calculateFavoriteExercises(user.exerciseHistories);

  return {
    autenticado: true,
    origem: "database",
    perfil: {
      idade: user.profile ? user.profile.age : null,
      peso: user.profile ? user.profile.weight : null,
      altura: user.profile ? user.profile.height : null,
      objetivo: valueOrFallback(user.profile && user.profile.goal, input.objetivo),
      nivel: valueOrFallback(user.profile && user.profile.level, input.nivel)
    },
    metas: user.goals.map((goal) => ({
      titulo: goal.title,
      categoria: goal.category,
      valorAtual: goal.currentValue,
      valorAlvo: goal.targetValue,
      status: goal.status
    })),
    recordes: user.records.map((record) => ({
      titulo: record.title,
      categoria: record.category,
      valor: record.value,
      unidade: record.unit,
      exercicio: record.exercise ? record.exercise.name : null,
      grupoMuscular: record.exercise ? record.exercise.muscleGroup : null,
      data: record.achievedAt
    })),
    historicoTreinos: {
      frequenciaRecente: workoutFrequency,
      recentes: user.workoutHistories.map((history) => ({
        nome: history.workout ? history.workout.name : "Treino",
        objetivo: history.workout ? history.workout.goal : null,
        divisao: history.workout ? history.workout.split : null,
        volumeTotal: history.totalVolume,
        seriesTotais: history.totalSets,
        duracaoSegundos: history.durationSeconds,
        iniciadoEm: history.startedAt
      })),
      planosRecentes: user.workouts.map((workout) => ({
        nome: workout.name,
        objetivo: workout.goal,
        nivel: workout.level,
        divisao: workout.split,
        diasPorSemana: workout.daysPerWeek,
        minutosEstimados: workout.estimatedMinutes
      }))
    },
    historicoExercicios: {
      favoritos: favoriteExercises,
      recentes: user.exerciseHistories.slice(0, 12).map((history) => ({
        nome: history.exercise ? history.exercise.name : "Exercicio",
        grupoMuscular: history.exercise ? history.exercise.muscleGroup : null,
        equipamento: history.exercise ? history.exercise.equipment : null,
        peso: history.weight,
        repeticoes: history.reps,
        series: history.sets,
        volume: history.volume,
        data: history.performedAt
      }))
    },
    corrida: user.runningHistories.map((run) => ({
      distanciaKm: run.distanceKm,
      duracaoSegundos: run.durationSeconds,
      velocidadeMedia: run.averageSpeed,
      data: run.performedAt
    })),
    preferencias: buildFormPreferences(input)
  };
}

function buildFormPreferences(input) {
  return {
    restricoes: input.restricoes,
    prioridades: input.prioridades,
    equipamentos: input.equipamentos,
    diasDisponiveis: input.diasPorSemana,
    tempoPorTreino: input.tempoPorTreino,
    local: input.local,
    minExerciciosPorDia: input.minExerciciosPorDia
  };
}

function calculateRecentFrequency(histories) {
  const since = Date.now() - 30 * 24 * 60 * 60 * 1000;

  return histories.filter((history) => {
    return new Date(history.startedAt).getTime() >= since;
  }).length;
}

function calculateFavoriteExercises(histories) {
  const counts = new Map();

  histories.forEach((history) => {
    const exercise = history.exercise;
    const name = exercise && exercise.name ? exercise.name : "";

    if (!name) {
      return;
    }

    const current = counts.get(name) || {
      nome: name,
      grupoMuscular: exercise.muscleGroup,
      equipamento: exercise.equipment,
      frequencia: 0
    };

    current.frequencia += 1;
    counts.set(name, current);
  });

  return Array.from(counts.values())
    .sort((a, b) => b.frequencia - a.frequencia)
    .slice(0, 8);
}

function valueOrFallback(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function logContext(message) {
  if (process.env.NODE_ENV !== "production") {
    console.info(`[ai-context] ${message}`);
  }
}

const ContextService = {
  loadWorkoutContext
};

module.exports = {
  ContextService,
  loadWorkoutContext
};
