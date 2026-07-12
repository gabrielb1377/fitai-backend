const { z } = require("zod");

const setSchema = z.object({
  weight: z.coerce.number().nonnegative().optional(),
  peso: z.coerce.number().nonnegative().optional(),
  reps: z.coerce.number().int().nonnegative().optional(),
  repeticoes: z.coerce.number().int().nonnegative().optional()
}).refine((value) => value.weight !== undefined || value.peso !== undefined, {
  message: "Cada serie precisa informar weight ou peso."
});

const requestSchema = z.object({
  exercise: z.object({
    id: z.string().trim().optional().default(""),
    key: z.string().trim().optional().default(""),
    name: z.string().trim().min(1),
    equipment: z.array(z.string()).optional().default([])
  }),
  config: z.object({
    sets: z.coerce.number().int().min(2).max(4).optional(),
    repRange: z.string().trim().optional(),
    restSeconds: z.coerce.number().int().min(30).max(180).optional(),
    goal: z.string().trim().optional(),
    level: z.string().trim().optional()
  }).optional().default({}),
  sessions: z.array(z.object({
    date: z.string().optional(),
    sets: z.array(setSchema).min(1)
  })).max(6).optional().default([])
});

function validateProgressionRequest(body) {
  const result = requestSchema.safeParse(normalizeProgressionBody(body));
  return result.success
    ? { valid: true, data: result.data }
    : { valid: false, errors: result.error.issues };
}

function normalizeProgressionBody(body) {
  if (body && body.exercise) return body;

  const currentConfig = body && body.currentConfig && typeof body.currentConfig === "object"
    ? body.currentConfig
    : {};
  const exerciseId = body && body.exerciseId ? String(body.exerciseId) : "";
  const exerciseKey = body && body.exerciseKey ? String(body.exerciseKey) : "";
  return {
    exercise: {
      id: exerciseId,
      key: exerciseKey,
      name: body && body.exerciseName ? String(body.exerciseName) : (exerciseId || exerciseKey || "Exercicio"),
      equipment: Array.isArray(body && body.equipment) ? body.equipment : []
    },
    config: {
      ...currentConfig,
      goal: body && body.goal !== undefined ? body.goal : currentConfig.goal,
      level: body && body.level !== undefined ? body.level : currentConfig.level
    },
    sessions: Array.isArray(body && body.history) ? body.history : []
  };
}

module.exports = { validateProgressionRequest, normalizeProgressionBody };
