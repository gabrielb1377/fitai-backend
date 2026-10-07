const { z } = require("zod");

const ACTION_VERSION = "AiActionProposal/v1";
const id = z.string().trim().min(1).max(128);
const reason = z.string().trim().min(1).max(500);
const proposalSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("USE_GENERATED_WORKOUT"), generationRequestId: z.string().uuid(), reason }).strict(),
  z.object({ type: z.literal("REPLACE_EXERCISE"), planId: id, previousExerciseId: id,
    canonicalExerciseId: id, reason }).strict(),
  z.object({ type: z.literal("ADD_EXERCISE_TO_PLAN"), planId: id, dayOrder: z.number().int().min(1).max(7),
    canonicalExerciseId: id, sets: z.number().int().min(1).max(20),
    repetitions: z.string().regex(/^\d{1,3}(?:-\d{1,3})?$/), restSeconds: z.number().int().min(0).max(600), reason }).strict()
]);
const confirmSchema = z.object({ contractVersion: z.literal(ACTION_VERSION), confirmed: z.literal(true), deviceId: id }).strict();
const emptySchema = z.object({ contractVersion: z.literal(ACTION_VERSION) }).strict();
const string = { type: "string" }, integer = { type: "integer" };
const actionJsonSchema = { anyOf: [
  { type: "USE_GENERATED_WORKOUT", generationRequestId: string },
  { type: "REPLACE_EXERCISE", planId: string, previousExerciseId: string, canonicalExerciseId: string },
  { type: "ADD_EXERCISE_TO_PLAN", planId: string, dayOrder: integer, canonicalExerciseId: string, sets: integer, repetitions: string, restSeconds: integer }
].map(({ type, ...fields }) => ({ type: "object", additionalProperties: false,
  properties: { type: { type: "string", enum: [type] }, ...fields, reason: string }, required: ["type", ...Object.keys(fields), "reason"] })) };
module.exports = { ACTION_VERSION, proposalSchema, confirmSchema, emptySchema, actionJsonSchema };
