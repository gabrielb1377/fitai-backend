const { z } = require("zod");

const READY_PLAN_CATEGORIES = [
  "Hipertrofia",
  "Emagrecimento",
  "Força",
  "Powerlifting",
  "Upper/Lower",
  "ABC",
  "ABCD",
  "ABCDE",
  "PPL",
  "Full Body",
  "Casa",
  "Academia",
  "Calistenia"
];

const readyPlanIdSchema = z.object({
  id: z.string().trim().uuid()
});

function parseReadyPlanId(params) {
  return formatResult(readyPlanIdSchema.safeParse(params || {}));
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

  return { valid: true, data: result.data, errors: [] };
}

module.exports = {
  READY_PLAN_CATEGORIES,
  parseReadyPlanId
};
