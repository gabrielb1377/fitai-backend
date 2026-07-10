const { randomUUID } = require("crypto");
const { z } = require("zod");

const exerciseJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "nome", "categoria", "musculos", "equipamentos", "series", "repeticoes", "descanso"],
  properties: {
    id: { type: "string" },
    nome: { type: "string" },
    categoria: { type: "string" },
    musculos: {
      type: "array",
      items: { type: "string" }
    },
    equipamentos: {
      type: "array",
      items: { type: "string" }
    },
    series: { type: "integer", minimum: 1 },
    repeticoes: { type: "string" },
    descanso: { type: "integer", minimum: 0 }
  }
};

const workoutResponseJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "nome",
    "descricao",
    "objetivo",
    "nivel",
    "tempoEstimado",
    "criadoPorIA",
    "dataCriacao",
    "dias",
    "exercicios"
  ],
  properties: {
    id: { type: "string" },
    nome: { type: "string" },
    descricao: { type: "string" },
    objetivo: { type: "string" },
    nivel: { type: "string" },
    tempoEstimado: { type: "number" },
    criadoPorIA: { type: "boolean", enum: [true] },
    dataCriacao: { type: "string" },
    dias: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "nome", "titulo", "diaSemana", "exercicios"],
        properties: {
          id: { type: "string" },
          nome: { type: "string" },
          titulo: { type: "string" },
          diaSemana: { type: "string" },
          exercicios: {
            type: "array",
            minItems: 1,
            items: exerciseJsonSchema
          }
        }
      }
    },
    exercicios: {
      type: "array",
      items: exerciseJsonSchema
    }
  }
};

const exerciseSchema = z.object({
  id: z.string().trim().min(1),
  nome: z.string().trim().min(1),
  categoria: z.string().trim().min(1),
  musculos: z.array(z.string()).default([]),
  equipamentos: z.array(z.string()).default([]),
  series: z.number().int().positive(),
  repeticoes: z.string().trim().min(1),
  descanso: z.number().int().nonnegative()
}).strict();

const workoutDaySchema = z.object({
  id: z.string().trim().min(1),
  nome: z.string().trim().min(1),
  titulo: z.string().trim().min(1),
  diaSemana: z.string().trim().min(1),
  exercicios: z.array(exerciseSchema).min(1)
}).strict();

const workoutResponseSchema = z.object({
  id: z.string().trim().min(1),
  nome: z.string().trim().min(1),
  descricao: z.string().trim().min(1),
  objetivo: z.string().trim().min(1),
  nivel: z.string().trim().min(1),
  tempoEstimado: z.number(),
  criadoPorIA: z.literal(true),
  dataCriacao: z.string().trim().min(1).refine(isValidDate, "dataCriacao invalida."),
  dias: z.array(workoutDaySchema).min(1),
  exercicios: z.array(exerciseSchema)
}).strict();

const WEEKDAYS = ["Segunda", "Terca", "Quarta", "Quinta", "Sexta", "Sabado", "Domingo"];
const DEFAULT_EQUIPMENT = ["peso corporal"];
const VALID_MIN_EXERCISES = [6, 7, 8, 9, 10];

function validateWorkoutResponse(value) {
  const result = workoutResponseSchema.safeParse(value);

  if (!result.success) {
    return {
      valid: false,
      data: null,
      errors: formatZodErrors(result.error)
    };
  }

  return {
    valid: true,
    data: result.data,
    errors: []
  };
}

function normalizeWorkoutResponse(value, input, options = {}) {
  const source = options.source || "unknown";
  const now = options.now || new Date();
  const base = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const normalizedDays = normalizeDays(base.dias, input);
  const normalized = {
    id: normalizeId(base.id),
    nome: normalizeText(base.nome, `${normalizeSplit(input.divisao)} - ${capitalize(input.objetivo)}`),
    descricao: normalizeText(base.descricao, buildDescription(input)),
    objetivo: normalizeText(base.objetivo, input.objetivo),
    nivel: normalizeText(base.nivel, input.nivel),
    tempoEstimado: normalizeNumber(base.tempoEstimado, input.tempoPorTreino || 60),
    criadoPorIA: true,
    dataCriacao: normalizeDate(base.dataCriacao, now),
    dias: normalizedDays,
    exercicios: normalizeTopLevelExercises(base.exercicios)
  };

  const validation = validateWorkoutResponse(normalized);

  if (!validation.valid) {
    console.warn(`[ai] fallback aplicado. source=${source} reason=normalized_response_invalid`);
    const fallback = buildSafeFallbackWorkout(input, now);
    const fallbackValidation = validateWorkoutResponse(fallback);

    if (!fallbackValidation.valid) {
      return {
        valid: false,
        data: null,
        errors: fallbackValidation.errors
      };
    }

    return {
      valid: true,
      data: fallbackValidation.data,
      errors: []
    };
  }

  if (!validateWorkoutResponse(base).valid) {
    console.warn(`[ai] fallback aplicado. source=${source} reason=incomplete_response_normalized`);
  }

  return validation;
}

function buildSafeFallbackWorkout(input, now = new Date()) {
  return {
    id: randomUUID(),
    nome: `${normalizeSplit(input.divisao)} - ${capitalize(input.objetivo)}`,
    descricao: buildDescription(input),
    objetivo: normalizeText(input.objetivo, "treino"),
    nivel: normalizeText(input.nivel, "iniciante"),
    tempoEstimado: normalizeNumber(input.tempoPorTreino, 60),
    criadoPorIA: true,
    dataCriacao: now.toISOString(),
    dias: normalizeDays(null, input),
    exercicios: []
  };
}

function normalizeDays(days, input) {
  const sourceDays = Array.isArray(days) && days.length > 0
    ? days
    : buildDefaultDays(input);

  const normalizedDays = sourceDays.map((day, index) => normalizeDay(day, index, input));

  return avoidConsecutiveDuplicates(normalizedDays, input);
}

function normalizeDay(day, index, input) {
  const source = day && typeof day === "object" && !Array.isArray(day) ? day : {};
  const title = normalizeText(source.titulo, normalizeText(source.grupo, `Dia ${String.fromCharCode(65 + index)}`));
  const sourceExercises = Array.isArray(source.exercicios) && source.exercicios.length > 0
    ? source.exercicios
    : buildDefaultExercises(title, input);
  const normalizedExercises = completeMinimumExercises(
    deduplicateExercises(sourceExercises.map((exercise) => normalizeExercise(exercise, title, input))),
    title,
    index,
    input
  );

  return {
    id: normalizeId(source.id),
    nome: normalizeText(source.nome, `Dia ${String.fromCharCode(65 + index)}`),
    titulo: title,
    diaSemana: normalizeText(source.diaSemana, WEEKDAYS[index % WEEKDAYS.length]),
    exercicios: normalizedExercises
  };
}

function normalizeExercise(exercise, category, input) {
  const source = exercise && typeof exercise === "object" && !Array.isArray(exercise) ? exercise : {};
  const descanso = source.descanso !== undefined ? source.descanso : source.descansoSegundos;

  return {
    id: normalizeId(source.id),
    nome: normalizeText(source.nome, "Exercicio"),
    categoria: normalizeText(source.categoria, category),
    musculos: normalizeStringArray(source.musculos, splitMuscles(category)),
    equipamentos: normalizeStringArray(source.equipamentos, input.equipamentos.length > 0 ? input.equipamentos : DEFAULT_EQUIPMENT),
    series: normalizeInteger(source.series, 3),
    repeticoes: normalizeText(source.repeticoes, input.objetivo === "forca" ? "4-6" : "8-12"),
    descanso: normalizeInteger(descanso, input.objetivo === "forca" ? 120 : 90)
  };
}

function normalizeTopLevelExercises(exercises) {
  if (!Array.isArray(exercises)) {
    return [];
  }

  return exercises.map((exercise) => normalizeExercise(exercise, "Geral", { equipamentos: [], objetivo: "" }));
}

function buildDefaultDays(input) {
  const split = normalizeSplit(input.divisao);
  const groups = {
    ABCD: ["Peito + Triceps", "Costas + Biceps", "Pernas", "Ombros + Abdomen"],
    ABC: ["Peito + Ombros + Triceps", "Costas + Biceps", "Pernas + Abdomen"],
    AB: ["Membros superiores", "Membros inferiores"],
    FULL_BODY: ["Corpo inteiro"]
  };
  const selectedGroups = groups[split] || groups.ABCD;
  const dayCount = Math.max(1, Math.min(normalizeInteger(input.diasPorSemana, selectedGroups.length), selectedGroups.length));

  return selectedGroups.slice(0, dayCount).map((group, index) => ({
    nome: `Dia ${String.fromCharCode(65 + index)}`,
    titulo: group,
    diaSemana: WEEKDAYS[index % WEEKDAYS.length],
    exercicios: buildDefaultExercises(group, input)
  }));
}

function buildDefaultExercises(category, input) {
  const exercisesByCategory = {
    "Peito + Triceps": [
      "Supino reto",
      "Supino inclinado",
      "Crucifixo",
      "Crossover",
      "Flexao de bracos",
      "Triceps corda",
      "Triceps testa",
      "Mergulho no banco",
      "Supino fechado",
      "Pullover"
    ],
    "Costas + Biceps": [
      "Puxada frontal",
      "Remada baixa",
      "Remada curvada",
      "Remada unilateral",
      "Barra fixa assistida",
      "Pulldown",
      "Rosca direta",
      "Rosca alternada",
      "Rosca martelo",
      "Face pull"
    ],
    Pernas: [
      "Agachamento livre",
      "Leg press",
      "Cadeira extensora",
      "Mesa flexora",
      "Afundo alternado",
      "Levantamento terra romeno",
      "Cadeira abdutora",
      "Panturrilha em pe",
      "Passada",
      "Glute bridge"
    ],
    "Ombros + Abdomen": [
      "Desenvolvimento com halteres",
      "Elevacao lateral",
      "Elevacao frontal",
      "Crucifixo inverso",
      "Face pull",
      "Remada alta",
      "Prancha",
      "Abdominal infra",
      "Dead bug",
      "Prancha lateral"
    ],
    "Peito + Ombros + Triceps": [
      "Supino reto",
      "Desenvolvimento com halteres",
      "Crucifixo",
      "Elevacao lateral",
      "Flexao de bracos",
      "Triceps pulley",
      "Triceps frances",
      "Mergulho no banco",
      "Supino inclinado",
      "Face pull"
    ],
    "Pernas + Abdomen": [
      "Agachamento livre",
      "Leg press",
      "Cadeira extensora",
      "Mesa flexora",
      "Afundo alternado",
      "Panturrilha em pe",
      "Prancha",
      "Abdominal infra",
      "Dead bug",
      "Prancha lateral"
    ],
    "Membros superiores": [
      "Supino reto",
      "Puxada frontal",
      "Desenvolvimento com halteres",
      "Remada baixa",
      "Elevacao lateral",
      "Crucifixo",
      "Rosca direta",
      "Triceps corda",
      "Face pull",
      "Rosca martelo"
    ],
    "Membros inferiores": [
      "Agachamento livre",
      "Leg press",
      "Mesa flexora",
      "Cadeira extensora",
      "Afundo alternado",
      "Levantamento terra romeno",
      "Panturrilha em pe",
      "Glute bridge",
      "Passada",
      "Cadeira abdutora"
    ],
    "Corpo inteiro": [
      "Agachamento livre",
      "Supino reto",
      "Puxada frontal",
      "Desenvolvimento com halteres",
      "Afundo alternado",
      "Remada unilateral",
      "Prancha",
      "Flexao de bracos",
      "Levantamento terra romeno",
      "Dead bug"
    ]
  };
  const bodyweightByCategory = {
    "Peito + Triceps": [
      "Flexao de bracos",
      "Flexao inclinada",
      "Flexao diamante",
      "Mergulho no banco",
      "Prancha com toque no ombro",
      "Flexao declinada",
      "Triceps no banco",
      "Isometria de flexao",
      "Mountain climber",
      "Prancha alta"
    ],
    "Costas + Biceps": [
      "Remada invertida",
      "Superman",
      "Remada isometrica com toalha",
      "Y-T-W no solo",
      "Prancha com remada simulada",
      "Barra fixa assistida",
      "Bird dog",
      "Pulldown com elastico",
      "Rosca com elastico",
      "Face pull com elastico"
    ],
    Pernas: [
      "Agachamento livre",
      "Afundo alternado",
      "Passada",
      "Agachamento sumo",
      "Glute bridge",
      "Stiff unilateral",
      "Panturrilha em pe",
      "Step-up",
      "Wall sit",
      "Agachamento com salto"
    ],
    "Ombros + Abdomen": [
      "Pike push-up",
      "Prancha",
      "Prancha lateral",
      "Dead bug",
      "Abdominal infra",
      "Elevacao de quadril",
      "Bear crawl",
      "Hollow hold",
      "Mountain climber",
      "Y-T-W no solo"
    ],
    "Peito + Ombros + Triceps": [
      "Flexao de bracos",
      "Pike push-up",
      "Mergulho no banco",
      "Flexao diamante",
      "Prancha com toque no ombro",
      "Flexao inclinada",
      "Triceps no banco",
      "Bear crawl",
      "Prancha alta",
      "Flexao declinada"
    ],
    "Pernas + Abdomen": [
      "Agachamento livre",
      "Afundo alternado",
      "Passada",
      "Glute bridge",
      "Panturrilha em pe",
      "Prancha",
      "Abdominal infra",
      "Dead bug",
      "Prancha lateral",
      "Mountain climber"
    ],
    "Membros superiores": [
      "Flexao de bracos",
      "Remada invertida",
      "Pike push-up",
      "Mergulho no banco",
      "Prancha com toque no ombro",
      "Superman",
      "Flexao diamante",
      "Y-T-W no solo",
      "Bear crawl",
      "Triceps no banco"
    ],
    "Membros inferiores": [
      "Agachamento livre",
      "Afundo alternado",
      "Passada",
      "Agachamento sumo",
      "Glute bridge",
      "Stiff unilateral",
      "Panturrilha em pe",
      "Step-up",
      "Wall sit",
      "Agachamento com salto"
    ],
    "Corpo inteiro": [
      "Agachamento livre",
      "Flexao de bracos",
      "Afundo alternado",
      "Prancha",
      "Remada invertida",
      "Glute bridge",
      "Dead bug",
      "Mountain climber",
      "Pike push-up",
      "Superman"
    ]
  };
  const selectedBank = shouldUseBodyweight(input) ? bodyweightByCategory : exercisesByCategory;
  const names = selectExerciseNames(selectedBank, category);
  const minExercises = getMinExercisesPerDay(input);
  const filteredNames = names.filter((name) => !isRestrictedExercise(name, category, input));
  const safeNames = filteredNames.length >= minExercises
    ? filteredNames
    : deduplicateNames([...filteredNames, ...selectExerciseNames(selectedBank, "Corpo inteiro")]);

  return safeNames.slice(0, minExercises).map((name, index) => ({
    nome: name,
    categoria: category,
    musculos: splitMuscles(category),
    equipamentos: input.equipamentos.length > 0 ? input.equipamentos : DEFAULT_EQUIPMENT,
    series: index === 0 ? 4 : 3,
    repeticoes: input.objetivo === "forca" ? "4-6" : "8-12",
    descanso: input.objetivo === "forca" ? 120 : 90
  }));
}

function completeMinimumExercises(exercises, category, dayIndex, input) {
  const minExercises = getMinExercisesPerDay(input);

  if (exercises.length >= minExercises) {
    return exercises;
  }

  const result = [...exercises];
  const candidates = buildDefaultExercises(category, input);

  candidates.forEach((candidate) => {
    if (result.length >= minExercises) {
      return;
    }

    const normalized = normalizeExercise(candidate, category, input);

    if (!hasExerciseName(result, normalized.nome)) {
      result.push(normalized);
    }
  });

  if (result.length < minExercises) {
    buildDefaultExercises("Corpo inteiro", input).forEach((candidate) => {
      if (result.length >= minExercises) {
        return;
      }

      const normalized = normalizeExercise(candidate, category, input);

      if (!hasExerciseName(result, normalized.nome)) {
        result.push(normalized);
      }
    });
  }

  if (result.length > exercises.length) {
    logDevelopment(
      `[ai] validacao aplicada. dia=${dayIndex + 1} minExerciciosPorDia=${minExercises} adicionados=${result.length - exercises.length}`
    );
  }

  return result;
}

function avoidConsecutiveDuplicates(days, input) {
  const correctedDays = days.map((day) => ({
    ...day,
    exercicios: [...day.exercicios]
  }));
  let corrections = 0;

  for (let index = 1; index < correctedDays.length; index += 1) {
    const previousNames = new Set(correctedDays[index - 1].exercicios.map((exercise) => normalizeKey(exercise.nome)));
    const currentNames = new Set(correctedDays[index].exercicios.map((exercise) => normalizeKey(exercise.nome)));

    correctedDays[index].exercicios = correctedDays[index].exercicios.map((exercise) => {
      if (!previousNames.has(normalizeKey(exercise.nome))) {
        return exercise;
      }

      const replacement = findReplacementExercise(correctedDays[index].titulo, input, currentNames, previousNames);

      if (!replacement) {
        return exercise;
      }

      corrections += 1;
      currentNames.delete(normalizeKey(exercise.nome));
      currentNames.add(normalizeKey(replacement.nome));

      return replacement;
    });

    correctedDays[index].exercicios = completeMinimumExercises(
      deduplicateExercises(correctedDays[index].exercicios),
      correctedDays[index].titulo,
      index,
      input
    );
  }

  if (corrections > 0) {
    logDevelopment(`[ai] validacao aplicada. duplicados_consecutivos_corrigidos=${corrections}`);
  }

  return correctedDays;
}

function findReplacementExercise(category, input, currentNames, previousNames) {
  const candidates = [
    ...buildDefaultExercises(category, input),
    ...buildDefaultExercises("Corpo inteiro", input)
  ];

  for (const candidate of candidates) {
    const normalized = normalizeExercise(candidate, category, input);
    const key = normalizeKey(normalized.nome);

    if (!currentNames.has(key) && !previousNames.has(key)) {
      return normalized;
    }
  }

  return null;
}

function deduplicateExercises(exercises) {
  const seen = new Set();
  const result = [];

  exercises.forEach((exercise) => {
    const key = normalizeKey(exercise.nome);

    if (!seen.has(key)) {
      seen.add(key);
      result.push(exercise);
    }
  });

  return result;
}

function hasExerciseName(exercises, name) {
  const key = normalizeKey(name);

  return exercises.some((exercise) => normalizeKey(exercise.nome) === key);
}

function selectExerciseNames(bank, category) {
  if (bank[category]) {
    return bank[category];
  }

  const categoryKey = normalizeKey(category);
  const matchedKeys = Object.keys(bank).filter((key) => {
    const normalizedKey = normalizeKey(key);

    return splitMuscles(category).some((muscle) => {
      const normalizedMuscle = normalizeKey(muscle);
      return normalizedKey.includes(normalizedMuscle) || categoryKey.includes(normalizedMuscle);
    });
  });

  if (matchedKeys.length === 0) {
    return bank["Corpo inteiro"];
  }

  return deduplicateNames(matchedKeys.flatMap((key) => bank[key]));
}

function deduplicateNames(names) {
  const seen = new Set();

  return names.filter((name) => {
    const key = normalizeKey(name);

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function shouldUseBodyweight(input) {
  const local = normalizeKey(input.local);

  return local.includes("casa") && input.equipamentos.length === 0;
}

function isRestrictedExercise(name, category, input) {
  const text = normalizeKey(`${name} ${category}`);

  return input.restricoes.some((restriction) => {
    const normalizedRestriction = normalizeKey(restriction);

    return normalizedRestriction && text.includes(normalizedRestriction);
  });
}

function getMinExercisesPerDay(input) {
  const minExercises = Number(input.minExerciciosPorDia);

  return VALID_MIN_EXERCISES.includes(minExercises) ? minExercises : 6;
}

function buildDescription(input) {
  const parts = [
    `Treino gerado para ${normalizeText(input.objetivo, "objetivo informado")}`,
    `nivel ${normalizeText(input.nivel, "informado")}`,
    `${normalizeInteger(input.diasPorSemana, 1)} dias por semana`,
    `${normalizeInteger(input.tempoPorTreino, 60)} minutos por treino`,
    `minimo de ${getMinExercisesPerDay(input)} exercicios por dia`,
    `local: ${normalizeText(input.local, "informado")}`
  ];

  if (input.observacoes) {
    parts.push(`observacoes: ${input.observacoes}`);
  }

  return parts.join(", ");
}

function normalizeId(value) {
  return normalizeText(value, randomUUID());
}

function normalizeText(value, fallback) {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  return String(fallback || "").trim();
}

function normalizeKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function normalizeStringArray(value, fallback = []) {
  if (!Array.isArray(value)) {
    return fallback;
  }

  const items = value
    .filter((item) => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);

  return items.length > 0 ? items : fallback;
}

function normalizeNumber(value, fallback) {
  const number = Number(value);

  return Number.isFinite(number) ? number : Number(fallback);
}

function normalizeInteger(value, fallback) {
  const number = Math.round(normalizeNumber(value, fallback));

  return number > 0 ? number : fallback;
}

function normalizeDate(value, fallbackDate) {
  if (typeof value === "string" && isValidDate(value)) {
    return value;
  }

  return fallbackDate.toISOString();
}

function isValidDate(value) {
  return !Number.isNaN(Date.parse(value));
}

function normalizeSplit(split) {
  return String(split || "")
    .trim()
    .toUpperCase()
    .replace("-", "_")
    .replace(" ", "_");
}

function capitalize(value) {
  const text = String(value || "").trim();

  if (!text) {
    return "Treino";
  }

  return text.charAt(0).toUpperCase() + text.slice(1);
}

function splitMuscles(category) {
  return String(category || "")
    .split("+")
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatZodErrors(error) {
  return error.issues.map((issue) => ({
    field: issue.path.join("."),
    message: issue.message
  }));
}

function logDevelopment(message) {
  if (process.env.NODE_ENV !== "production") {
    console.info(message);
  }
}

module.exports = {
  workoutResponseJsonSchema,
  workoutResponseSchema,
  validateWorkoutResponse,
  normalizeWorkoutResponse,
  buildSafeFallbackWorkout
};
