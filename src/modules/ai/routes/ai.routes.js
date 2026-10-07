const { Router } = require("express");
const asyncHandler = require("../../../shared/utils/async-handler");
const { authenticateJWT } = require("../../auth/auth.middleware");
const { aiRateLimit } = require("../../../shared/middleware/ai-rate-limit.middleware");
const { generateWorkoutController } = require("../controller/ai.controller");
const { createChatController } = require("../chat/chat.controller");
const { createActionController } = require("../actions/action.controller");

const router = Router();

router.post("/generate-workout", authenticateJWT, aiRateLimit, asyncHandler(generateWorkoutController));
const chat = createChatController();
router.post("/chat", authenticateJWT, aiRateLimit, asyncHandler(chat.send));
router.get("/chat/conversations/:conversationId", authenticateJWT, asyncHandler(chat.history));
const actions = createActionController();
router.get("/actions/:actionId", authenticateJWT, asyncHandler(actions.get));
router.post("/actions/:actionId/confirm", authenticateJWT, asyncHandler(actions.confirm));
router.post("/actions/:actionId/cancel", authenticateJWT, asyncHandler(actions.cancel));
router.post("/actions/:actionId/complete", authenticateJWT, asyncHandler(actions.complete));

module.exports = router;
