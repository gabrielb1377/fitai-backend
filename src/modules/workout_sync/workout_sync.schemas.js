const { z } = require("zod");

const supportedEventTypes = new Set([
  "workout_session_started",
  "workout_set_completed",
  "workout_session_paused",
  "workout_session_resumed",
  "workout_session_progressed",
  "workout_exercise_changed",
  "workout_session_finished",
  "workout_session_discarded"
]);

const batchSchema = z.object({
  deviceId: z.string().trim().min(1).max(120),
  sessionId: z.string().trim().min(1).max(120).optional(),
  events: z.array(z.unknown()).min(1).max(20)
}).strict();

const eventSchema = z.object({
  eventId: z.string().trim().min(1).max(120),
  idempotencyKey: z.string().trim().min(1).max(180),
  eventType: z.string().trim().refine(
    (value) => supportedEventTypes.has(value),
    "Tipo de evento nao suportado."
  ),
  aggregateId: z.string().trim().min(1).max(120),
  occurredAt: z.coerce.date(),
  version: z.number().int().positive().max(1000000),
  payload: z.record(z.string(), z.unknown()).superRefine((value, context) => {
    if (Buffer.byteLength(JSON.stringify(value), "utf8") > 20000) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Payload do evento excede 20 KB."
      });
    }
  })
}).strict();

function parseWorkoutSyncBatch(body) {
  return batchSchema.safeParse(body);
}

function parseWorkoutSyncEvent(body) {
  return eventSchema.safeParse(body);
}

function formatZodIssues(error) {
  return error.issues.map((issue) => ({
    field: issue.path.join("."),
    message: issue.message
  }));
}

module.exports = {
  parseWorkoutSyncBatch,
  parseWorkoutSyncEvent,
  formatZodIssues,
  supportedEventTypes
};
