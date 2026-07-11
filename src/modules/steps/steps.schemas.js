const { z } = require("zod");

const sourceSchema = z.enum(["health_connect", "local", "manual"]).default("local");

const stepItemSchema = z.object({
  id: z.string().trim().optional(),
  date: z.string().trim().min(8),
  steps: z.number().int().nonnegative(),
  goal: z.number().int().positive().default(10000),
  source: sourceSchema,
  updatedAt: z.string().trim().optional(),
  syncedAt: z.string().trim().nullable().optional()
}).passthrough();

const stepsPayloadSchema = z.object({
  clientId: z.string().trim().min(1).optional(),
  item: stepItemSchema.optional(),
  items: z.array(stepItemSchema).optional()
}).passthrough();

const rangeQuerySchema = z.object({
  clientId: z.string().trim().optional(),
  from: z.string().trim().optional(),
  to: z.string().trim().optional()
}).passthrough();

const statsQuerySchema = z.object({
  clientId: z.string().trim().optional(),
  period: z.enum(["7d", "30d"]).default("7d")
}).passthrough();

function parseStepsPayload(body) {
  const result = stepsPayloadSchema.safeParse(
    body && typeof body === "object" && !Array.isArray(body) ? body : {}
  );

  return formatResult(result);
}

function parseRangeQuery(query) {
  return formatResult(rangeQuerySchema.safeParse(query || {}));
}

function parseStatsQuery(query) {
  return formatResult(statsQuerySchema.safeParse(query || {}));
}

function getStepItems(payload) {
  if (Array.isArray(payload.items)) return payload.items;
  if (payload.item) return [payload.item];

  const reserved = new Set(["clientId", "item", "items"]);
  const hasLooseItem = Object.keys(payload || {}).some((key) => !reserved.has(key));

  return hasLooseItem ? [payload] : [];
}

function formatResult(result) {
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
  parseStepsPayload,
  parseRangeQuery,
  parseStatsQuery,
  getStepItems
};
