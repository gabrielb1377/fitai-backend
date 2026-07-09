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

  return sourceDays.map((day, index) => normalizeDay(day, index, input));
}

function normalizeDay(day, index, input) {
  const source = day && typeof day === "object" && !Array.isArray(day) ? day : {};
  const title = normalizeText(source.titulo, normalizeText(source.grupo, `Dia ${String.fromCharCode(65 + index)}`));
  const exercises = Array.isArray(source.exercicios) && source.exercicios.length > 0
    ? source.exercicios
    : buildDefaultExercises(title, input);

  return {
    id: normalizeId(source.id),
    nome: normalizeText(source.nome, `Dia ${String.fromCharCode(65 + index)}`),
    titulo: title,
    diaSemana: normalizeText(source.diaSemana, WEEKDAYS[index % WEEKDAYS.length]),
    exercicios: exercises.map((exercise) => normalizeExercise(exercise, title, input))
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
    "Peito + Triceps": ["Supino reto", "Supino inclinado com halteres", "Crucifixo na maquina", "Triceps corda"],
    "Costas + Biceps": ["Puxada frontal", "Remada baixa", "Remada curvada", "Rosca direta"],
    Pernas: ["Agachamento livre", "Leg press", "Cadeira extensora", "Mesa flexora"],
    "Ombros + Abdomen": ["Desenvolvimento com halteres", "Elevacao lateral", "Face pull", "Prancha"],
    "Peito + Ombros + Triceps": ["Supino reto", "Desenvolvimento com halteres", "Crucifixo na maquina", "Triceps pulley"],
    "Pernas + Abdomen": ["Agachamento livre", "Leg press", "Cadeira extensora", "Prancha"],
    "Membros superiores": ["Supino reto", "Puxada frontal", "Desenvolvimento com halteres", "Rosca direta"],
    "Membros inferiores": ["Agachamento livre", "Leg press", "Mesa flexora", "Panturrilha em pe"],
    "Corpo inteiro": ["Agachamento livre", "Supino reto", "Puxada frontal", "Desenvolvimento com halteres"]
  };
  const names = exercisesByCategory[category] || exercisesByCategory["Corpo inteiro"];

  return names.map((name, index) => ({
    nome: name,
    categoria: category,
    musculos: splitMuscles(category),
    equipamentos: input.equipamentos.length > 0 ? input.equipamentos : DEFAULT_EQUIPMENT,
    series: index === 0 ? 4 : 3,
    repeticoes: input.objetivo === "forca" ? "4-6" : "8-12",
    descanso: input.objetivo === "forca" ? 120 : 90
  }));
}

function buildDescription(input) {
  const parts = [
    `Treino gerado para ${normalizeText(input.objetivo, "objetivo informado")}`,
    `nivel ${normalizeText(input.nivel, "informado")}`,
    `${normalizeInteger(input.diasPorSemana, 1)} dias por semana`,
    `${normalizeInteger(input.tempoPorTreino, 60)} minutos por treino`,
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

module.exports = {
  workoutResponseJsonSchema,
  workoutResponseSchema,
  validateWorkoutResponse,
  normalizeWorkoutResponse,
  buildSafeFallbackWorkout
};
