const { Router } = require("express");
const asyncHandler = require("../../../shared/utils/async-handler");
const { authenticateJWT } = require("../../auth/auth.middleware");
const { aiRateLimit } = require("../../../shared/middleware/ai-rate-limit.middleware");
const { generateWorkoutController } = require("../controller/ai.controller");
const { createChatController } = require("../chat/chat.controller");
const { createChatService } = require("../chat/chat.service");
const { createActionController } = require("../actions/action.controller");

function createAiRouter({ chatGateway } = {}) {
  const router = Router();
  router.post("/generate-workout", authenticateJWT, aiRateLimit, asyncHandler(generateWorkoutController));
  const chat = createChatController(chatGateway ? createChatService({ gateway: chatGateway }) : undefined);
  router.post("/chat", authenticateJWT, aiRateLimit, asyncHandler(chat.send));
  router.get("/chat/conversations/:conversationId", authenticateJWT, asyncHandler(chat.history));
  const actions = createActionController();
  router.get("/actions/:actionId", authenticateJWT, asyncHandler(actions.get));
  router.post("/actions/:actionId/confirm", authenticateJWT, asyncHandler(actions.confirm));
  router.post("/actions/:actionId/cancel", authenticateJWT, asyncHandler(actions.cancel));
  router.post("/actions/:actionId/complete", authenticateJWT, asyncHandler(actions.complete));
  return router;
}

module.exports = createAiRouter();
module.exports.createAiRouter = createAiRouter;
