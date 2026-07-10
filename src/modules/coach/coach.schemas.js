const { z } = require("zod");

const ALLOWED_TYPES = [
  "geral",
  "exercicio",
  "progressao",
  "recuperacao",
  "frequencia",
  "metas",
  "corrida"
];

const coachRequestSchema = z.object({
  tipo: z.enum(ALLOWED_TYPES).default("geral"),
  exercicioId: z.string().trim().nullable().optional(),
  periodoDias: z.number().int().positive().max(365).default(30),
  contextoLocal: z.object({
    perfil: z.record(z.string(), z.any()).optional().default({}),
    planos: z.array(z.record(z.string(), z.any())).optional().default([]),
    historicoTreinos: z.array(z.record(z.string(), z.any())).optional().default([]),
    historicoExercicios: z.array(z.record(z.string(), z.any())).optional().default([]),
    recordes: z.array(z.record(z.string(), z.any())).optional().default([]),
    metas: z.array(z.record(z.string(), z.any())).optional().default([]),
    corridas: z.array(z.record(z.string(), z.any())).optional().default([])
  }).passthrough().optional().default({}),
  forceRefresh: z.boolean().optional().default(false),
  clientId: z.string().trim().optional()
}).passthrough();

function validateCoachRequest(body) {
  const result = coachRequestSchema.safeParse(
    body && typeof body === "object" && !Array.isArray(body) ? body : {}
  );

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
    data: {
      ...result.data,
      exercicioId: result.data.exercicioId || null
    },
    errors: []
  };
}

module.exports = {
  ALLOWED_TYPES,
  validateCoachRequest
};
