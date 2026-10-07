const { z } = require("zod");
const AppError = require("../../../shared/errors/app-error");
const { createActionService } = require("./action.service");
const { confirmSchema, emptySchema } = require("./action.schema");

function createActionController(service = createActionService()) {
  const run = (method, schema) => async (req, res) => {
    const id = z.string().uuid().safeParse(req.params.actionId);
    const parsed = schema ? schema.safeParse(req.body) : { success: true, data: {} };
    if (!id.success || !parsed.success) throw new AppError("Confirmacao invalida.", 400, "ai_action_invalid_request");
    try { res.json(await service[method]({ userId: req.auth.userId, actionId: id.data, deviceId: parsed.data.deviceId })); }
    catch (e) {
      if (e instanceof AppError) throw e;
      throw new AppError("Nao foi possivel verificar a sugestao agora.", 503, "ai_action_unavailable");
    }
  };
  return { confirm: run("confirm", confirmSchema), cancel: run("cancel", emptySchema), complete: run("complete", emptySchema), get: run("get") };
}
module.exports = { createActionController };
