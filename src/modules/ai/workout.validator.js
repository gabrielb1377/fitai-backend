const { z } = require("zod");

const workoutResponseJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["nome", "descricao", "objetivo", "nivel", "dias"],
  properties: {
    nome: { type: "string" },
    descricao: { type: "string" },
    objetivo: { type: "string" },
    nivel: { type: "string" },
    dias: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["nome", "grupo", "exercicios"],
        properties: {
          nome: { type: "string" },
          grupo: { type: "string" },
          exercicios: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["nome", "series", "repeticoes", "descansoSegundos", "observacoes"],
              properties: {
                nome: { type: "string" },
                series: { type: "integer", minimum: 1 },
                repeticoes: { type: "string" },
                descansoSegundos: { type: "integer", minimum: 0 },
                observacoes: { type: "string" }
              }
            }
          }
        }
      }
    }
  }
};

const exerciseSchema = z.object({
  nome: z.string().trim().min(1),
  series: z.number().int().positive(),
  repeticoes: z.string().trim().min(1),
  descansoSegundos: z.number().int().nonnegative(),
  observacoes: z.string().trim()
}).strict();

const workoutDaySchema = z.object({
  nome: z.string().trim().min(1),
  grupo: z.string().trim().min(1),
  exercicios: z.array(exerciseSchema).min(1)
}).strict();

const workoutResponseSchema = z.object({
  nome: z.string().trim().min(1),
  descricao: z.string().trim().min(1),
  objetivo: z.string().trim().min(1),
  nivel: z.string().trim().min(1),
  dias: z.array(workoutDaySchema).min(1)
}).strict();

function validateWorkoutResponse(value) {
  const result = workoutResponseSchema.safeParse(value);

  if (!result.success) {
    return {
      valid: false,
      data: null,
      errors: result.error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message
      }))
    };
  }

  return {
    valid: true,
    data: result.data,
    errors: []
  };
}

module.exports = {
  workoutResponseJsonSchema,
  workoutResponseSchema,
  validateWorkoutResponse
};
