const { z } = require("zod");
const { CONTRACT_VERSION, MAX_BATCH_ITEMS } = require("./activity_sync.rules");

const finiteNonNegative = z.number().finite().nonnegative();
const revision = z.string().regex(/^\d+$/);
const dayKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(isRealDay, "dayKey invalido.");

const routePointSchema = z.object({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  accuracy: finiteNonNegative,
  altitude: z.number().finite(),
  speed: finiteNonNegative,
  timestamp: z.coerce.date(),
  cumulativeDistanceKm: finiteNonNegative.optional(),
  activeElapsedSeconds: z.number().int().nonnegative().optional(),
  startsSegment: z.boolean().optional()
}).strict();

const runSchema = z.object({
  mutationId: z.string().trim().min(1).max(512),
  runId: z.string().trim().min(1).max(240),
  startedAt: z.coerce.date(),
  finishedAt: z.coerce.date(),
  durationSeconds: z.number().int().nonnegative().max(60 * 60 * 24 * 14),
  distanceKm: finiteNonNegative.max(10000),
  averageSpeed: finiteNonNegative.max(500),
  paceMinutesPerKm: finiteNonNegative.max(10000),
  route: z.array(routePointSchema).max(100000),
  calories: finiteNonNegative.nullable().optional(),
  steps: z.number().int().nonnegative().nullable().optional(),
  deletedAt: z.coerce.date().nullable().optional()
}).strict().refine((value) => value.finishedAt >= value.startedAt, {
  message: "finishedAt deve ser posterior a startedAt.",
  path: ["finishedAt"]
}).superRefine((value, context) => {
  let distance = 0;
  let seconds = 0;
  let timestamp = null;
  for (const [index, point] of value.route.entries()) {
    const hasProgress = point.cumulativeDistanceKm !== undefined ||
      point.activeElapsedSeconds !== undefined || point.startsSegment !== undefined;
    if (!hasProgress) continue;
    if (point.cumulativeDistanceKm === undefined || point.activeElapsedSeconds === undefined ||
        point.cumulativeDistanceKm < distance ||
        point.cumulativeDistanceKm > value.distanceKm + 1e-9 ||
        point.activeElapsedSeconds < seconds || point.activeElapsedSeconds > value.durationSeconds ||
        (timestamp && point.timestamp <= timestamp) ||
        (point.cumulativeDistanceKm - distance > (point.activeElapsedSeconds - seconds + 1) / 100) ||
        (point.startsSegment === true && point.cumulativeDistanceKm !== distance)) {
      context.addIssue({ code: "custom", path: ["route", index], message: "Progresso canonico invalido." });
    }
    distance = point.cumulativeDistanceKm;
    seconds = point.activeElapsedSeconds;
    timestamp = point.timestamp;
  }
});

const stepsSchema = z.object({
  mutationId: z.string().trim().min(1).max(512),
  dayKey,
  steps: z.number().int().nonnegative().max(10000000),
  goal: z.number().int().positive().max(10000000),
  source: z.enum(["local", "manual", "device", "health_connect", "health_kit"]),
  observedAt: z.coerce.date(),
  clientVersion: z.number().int().positive().max(2147483647)
}).strict();

const batchSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION),
  deviceId: z.string().trim().min(1).max(120),
  afterRevision: revision.default("0"),
  runs: z.array(z.unknown()).max(MAX_BATCH_ITEMS).default([]),
  steps: z.array(z.unknown()).max(MAX_BATCH_ITEMS).default([])
}).strict().refine((value) => value.runs.length + value.steps.length > 0, {
  message: "O lote deve conter ao menos uma mutacao."
});

const pullSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION).default(CONTRACT_VERSION),
  afterRevision: revision.default("0")
}).strict();

function isRealDay(value) {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function formatZodIssues(error) {
  return error.issues.map((issue) => ({
    field: issue.path.join("."),
    message: issue.message
  }));
}

module.exports = {
  parseBatch: (body) => batchSchema.safeParse(body),
  parsePull: (query) => pullSchema.safeParse(query || {}),
  parseRun: (value) => runSchema.safeParse(value),
  parseSteps: (value) => stepsSchema.safeParse(value),
  formatZodIssues
};
