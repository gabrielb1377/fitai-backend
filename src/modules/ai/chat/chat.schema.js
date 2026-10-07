const { z } = require("zod");

const CHAT_VERSION = "AiChatContract/v1";
const CHAT_TASKS = ["chat", "analyze_progress", "running_advice"];
const chatRequestSchema = z.object({
  contractVersion: z.literal(CHAT_VERSION),
  conversationId: z.string().uuid().nullable().optional(),
  clientRequestId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/),
  message: z.string().trim().min(1).max(2000),
  intent: z.enum(CHAT_TASKS).optional()
}).strict();

function selectTask(input, previousTask = "chat") {
  if (input.intent) return input.intent;
  const message = input.message.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const strength = /supino|carga|repetico|musculacao|pernas|serie/.test(message);
  const steps = /passos|steps/.test(message);
  if ((strength || steps) && /corrida|correr|ritmo|pace|parciais/.test(message)) return "analyze_progress";
  if (/semana|o que.*hoje|evoluindo|evolucao geral/.test(message)) return "analyze_progress";
  if (strength || steps) return /progresso|performance|volume|xp/.test(message) ? "analyze_progress" : "chat";
  if (/corrida|correr|ritmo|pace|parciais/.test(message)) return "running_advice";
  if (/progresso|evolucao|performance|volume|recorde|xp/.test(message)) return "analyze_progress";
  return CHAT_TASKS.includes(previousTask) ? previousTask : "chat";
}

module.exports = { CHAT_VERSION, CHAT_TASKS, chatRequestSchema, selectTask };
