const { z } = require("zod");

const jsonObjectSchema = z.record(z.string(), z.any());

const syncPayloadSchema = z.object({
  clientId: z.string().trim().min(1).optional(),
  profile: jsonObjectSchema.optional(),
  item: jsonObjectSchema.optional(),
  items: z.array(jsonObjectSchema).optional(),
  series: z.array(jsonObjectSchema).optional()
}).passthrough();

function parseSyncPayload(body) {
  const result = syncPayloadSchema.safeParse(
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
    data: result.data,
    errors: []
  };
}

function getPayloadItems(payload) {
  if (Array.isArray(payload.items)) {
    return payload.items;
  }

  if (payload.item && typeof payload.item === "object") {
    return [payload.item];
  }

  const reserved = new Set(["clientId", "profile", "item", "items", "series"]);
  const keys = Object.keys(payload || {}).filter((key) => !reserved.has(key));

  if (keys.length > 0) {
    return [payload];
  }

  return [];
}

module.exports = {
  parseSyncPayload,
  getPayloadItems
};
