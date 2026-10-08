const { z } = require("zod");
const {
  CONTRACT_VERSION,
  RULES_VERSION,
  supportedSourceTypes
} = require("./progression.sync.rules");

const batchSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION),
  rulesVersion: z.number().int().positive().max(1000000),
  deviceId: z.string().trim().min(1).max(120),
  afterRevision: z.string().trim().regex(/^\d+$/).default("0"),
  events: z.array(z.unknown()).min(1).max(50)
}).strict();

const eventSchema = z.object({
  eventId: z.string().trim().min(1).max(512),
  sourceType: z.string().trim().refine(
    (value) => supportedSourceTypes.has(value),
    "Tipo de origem nao suportado."
  ),
  sourceId: z.string().trim().min(1).max(240),
  occurredAt: z.coerce.date(),
  rulesVersion: z.number().int().positive().max(1000000)
}).strict();

const pullQuerySchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION).default(CONTRACT_VERSION),
  afterRevision: z.string().trim().regex(/^\d+$/).default("0")
}).strict();

function parseProgressionSyncBatch(body) {
  return batchSchema.safeParse(body);
}

function parseProgressionSyncEvent(body) {
  return eventSchema.safeParse(body);
}

function parseProgressionPullQuery(query) {
  return pullQuerySchema.safeParse(query || {});
}

function formatZodIssues(error) {
  return error.issues.map((issue) => ({
    field: issue.path.join("."),
    message: issue.message
  }));
}

module.exports = {
  parseProgressionSyncBatch,
  parseProgressionSyncEvent,
  parseProgressionPullQuery,
  formatZodIssues,
  CONTRACT_VERSION,
  RULES_VERSION
};
