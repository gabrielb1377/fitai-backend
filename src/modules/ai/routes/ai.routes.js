const { Router } = require("express");
const asyncHandler = require("../../../shared/utils/async-handler");
const { authenticateJWT } = require("../../auth/auth.middleware");
const { aiRateLimit } = require("../../../shared/middleware/ai-rate-limit.middleware");
const { generateWorkoutController } = require("../controller/ai.controller");
const { createChatController } = require("../chat/chat.controller");

const router = Router();

router.post("/generate-workout", authenticateJWT, aiRateLimit, asyncHandler(generateWorkoutController));
const chat = createChatController();
router.post("/chat", authenticateJWT, aiRateLimit, asyncHandler(chat.send));
router.get("/chat/conversations/:conversationId", authenticateJWT, asyncHandler(chat.history));

module.exports = router;
