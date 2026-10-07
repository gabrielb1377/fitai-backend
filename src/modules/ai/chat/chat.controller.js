const { z } = require("zod");
const AppError = require("../../../shared/errors/app-error");
const { chatRequestSchema } = require("./chat.schema");
const { createChatService } = require("./chat.service");

function createChatController(service = createChatService()) {
  async function safe(action) {
    try { return await action(); }
    catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError("Nao foi possivel acessar a conversa agora.", 503, "ai_chat_unavailable");
    }
  }
  return {
    async send(req, res) {
      const parsed = chatRequestSchema.safeParse(req.body);
      if (!parsed.success) throw new AppError("Mensagem invalida.", 400, "invalid_chat_request");
      const result = await safe(() => service.send({ userId: req.auth.userId, input: parsed.data }));
      if (result.replay) res.set("Idempotent-Replay", "true");
      res.json(result.response);
    },
    async history(req, res) {
      const parsed = z.string().uuid().safeParse(req.params.conversationId);
      if (!parsed.success) throw new AppError("Conversa invalida.", 400, "invalid_conversation_id");
      res.json(await safe(() => service.history({ userId: req.auth.userId, conversationId: parsed.data })));
    }
  };
}
module.exports = { createChatController };
