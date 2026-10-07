const { randomUUID } = require("node:crypto");
const prisma = require("../../../config/prisma");
const AppError = require("../../../shared/errors/app-error");
const { ACTION_VERSION, proposalSchema } = require("./action.schema");
const { planSnapshot, loadSnapshot, projectResult, digest, include } = require("./plan.snapshot");
const { validateWorkoutCatalog, projection, replacementCompatibility } = require("../gateway/catalog");
const { parseWorkoutResponse } = require("../response.parser");
const { AI_OPERATIONS } = require("../ai-usage.service");
const { withDeadline } = require("../gateway/gateway");

const expiryMs = 30 * 60 * 1000;
const TRANSACTION_ATTEMPTS = 5;
function createActionService({ client = prisma, now = () => new Date(),
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  async function transaction(fn) {
    for (let attempt = 0; attempt < TRANSACTION_ATTEMPTS; attempt++) {
      try { return await client.$transaction(fn, { isolationLevel: "Serializable" }); }
      catch (e) {
        if (e.code !== "P2034" || attempt === TRANSACTION_ATTEMPTS - 1) throw e;
        await wait(50 * 2 ** attempt);
      }
    }
  }
  function dto(row) {
    return { contractVersion: ACTION_VERSION, actionId: row.id, actionType: row.actionType, status: row.status,
      conversationId: row.conversationId, sourceMessageId: row.sourceMessageId, title: row.title,
      explanation: row.explanation, payload: row.payload, preview: row.preview,
      validation: { code: row.validationCode }, expiresAt: row.expiresAt.toISOString(),
      resultReference: row.resultReference, executionDeviceId: row.executionDeviceId,
      expectedBefore: row.expectedBefore, expectedAfter: row.expectedAfter };
  }
  async function owned(db, userId, id) {
    const action = await db.aiActionProposal.findFirst({ where: { id, userId } });
    if (!action) throw new AppError("Sugestao nao encontrada.", 404, "ai_action_not_found");
    return action;
  }
  async function validate(db, userId, candidate, actionId) {
    const parsed = proposalSchema.safeParse(candidate);
    if (!parsed.success) throw new AppError("Proposta invalida ou nao suportada.", 400, "ai_action_invalid_proposal");
    const p = parsed.data;
    if (p.type === "USE_GENERATED_WORKOUT") {
      const generation = await db.aiUsage.findFirst({ where: { id: p.generationRequestId, userId, operation: AI_OPERATIONS.workout, status: "succeeded" } });
      if (!generation?.response) throw new AppError("Geracao valida nao encontrada.", 404, "ai_action_generation_not_found");
      const workout = parseWorkoutResponse({ output_text: JSON.stringify(generation.response) }, {});
      validateWorkoutCatalog(workout, actionId);
      const planId = `ai-action-${actionId}`;
      const entries = workout.dias.flatMap((d) => d.exercicios);
      if (new Set(entries.map((e) => e.id)).size !== entries.length || entries.length > 100 || workout.dias.length > 7) throw new AppError("Geracao ambigua.", 409, "ai_action_invalid_generation");
      const after = { id: planId, nome: workout.nome, objetivo: workout.objetivo, nivel: workout.nivel, divisao: "Full Body",
        diasPorSemana: workout.dias.length, tempoEstimado: Math.round(workout.tempoEstimado),
        exercicios: entries.map((e) => ({ id: e.id, series: e.series, repeticoes: e.repeticoes, descansoSegundos: e.descanso,
          rir: "", cadencia: "", observacoesTreino: `S\u00e9ries: ${e.series} | Repeti\u00e7\u00f5es: ${e.repeticoes} | Descanso: ${e.descanso}s` })).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
        planoDias: workout.dias.map((d, i) => ({ codigo: d.nome, nome: d.titulo, ordem: i + 1, exercicioIds: d.exercicios.map((e) => e.id) })) };
      return { payload: { ...p, workout: { ...workout, id: planId } }, before: null, after,
        preview: { before: "Nenhum novo plano", after: workout.nome, details: workout.dias.map((d) => `${d.nome}: ${d.exercicios.length} exercicios`) } };
    }
    const before = await loadSnapshot(db, userId, p.planId);
    const active = await db.workoutSyncSession.findFirst({ where: { userId, planId: p.planId, status: { in: ["active", "paused", "running", "in_progress"] } } });
    if (active) throw new AppError("Conclua a sessao ativa antes de alterar a ficha.", 409, "ai_action_active_session");
    const after = projectResult(before, p);
    if (p.type === "REPLACE_EXERCISE" && replacementCompatibility(p.previousExerciseId, p.canonicalExerciseId) === "INCOMPATIBLE") {
      throw new AppError("A substituicao nao corresponde ao movimento ou grupo muscular registrado.", 409, "ai_action_incompatible_replacement");
    }
    const from = p.type === "REPLACE_EXERCISE" ? p.previousExerciseId : before.nome;
    return { payload: p, before, after,
      preview: { before: from, after: p.canonicalExerciseId, details: [before.nome, "Altera somente a ficha futura; historico e series permanecem intactos."] } };
  }
  async function propose({ db = client, userId, conversationId, sourceMessageId, candidates = [] }) {
    if (!candidates.length) return [];
    const conversation = await db.aiConversation.findFirst({ where: { id: conversationId, userId } });
    if (!conversation) throw new AppError("Conversa nao encontrada.", 404, "conversation_not_found");
    const source = await db.aiChatMessage.findFirst({ where: { id: sourceMessageId, conversationId, role: "assistant" } });
    if (!source) throw new AppError("Mensagem nao encontrada.", 404, "ai_action_source_not_found");
    const rows = [];
    for (const [ordinal, candidate] of candidates.slice(0, 2).entries()) {
      const id = randomUUID();
      let validated, code = "valid", status = "VALIDATED";
      try { validated = await validate(db, userId, candidate, id); }
      catch (e) { if (!(e instanceof AppError)) throw e; code = e.code; status = "REJECTED"; }
      rows.push(dto(await db.aiActionProposal.create({ data: { id, userId, conversationId, sourceMessageId, ordinal,
        actionType: validated?.payload.type || "UNSUPPORTED", status, title: validated ? "Sugestao para sua ficha" : "Sugestao indisponivel",
        explanation: validated?.payload.reason || "A sugestao nao passou pela validacao do FitIA.",
        payload: validated?.payload || {}, preview: validated?.preview || {}, expectedBefore: validated?.before || undefined,
        expectedAfter: validated?.after || undefined, validationCode: code, expiresAt: new Date(+now() + expiryMs) } })));
    }
    return rows;
  }
  async function confirm({ userId, actionId, deviceId }) {
    return transaction(async (db) => {
      const row = await owned(db, userId, actionId);
      if (row.status === "EXECUTED") return dto(row);
      if (row.status === "CONFIRMED") {
        if (row.executionDeviceId !== deviceId) throw new AppError("Esta sugestao esta em execucao em outro dispositivo.", 409, "ai_action_device_conflict");
        return dto(row);
      }
      if (row.status !== "VALIDATED") throw new AppError("Esta sugestao nao pode ser confirmada.", 409, "ai_action_not_confirmable");
      if (row.expiresAt <= now()) {
        return dto(await db.aiActionProposal.update({ where: { id: row.id }, data: { status: "EXPIRED", validationCode: "ai_action_expired" } }));
      }
      let checked;
      try { checked = await validate(db, userId, proposalSchema.parse(row.payload.type === "USE_GENERATED_WORKOUT" ?
        { type: row.payload.type, generationRequestId: row.payload.generationRequestId, reason: row.payload.reason } : row.payload), row.id); }
      catch (e) {
        if (!(e instanceof AppError)) throw e;
        return dto(await db.aiActionProposal.update({ where: { id: row.id }, data: { status: "REJECTED", validationCode: e.code } }));
      }
      if (digest(checked.before) !== digest(row.expectedBefore)) {
        return dto(await db.aiActionProposal.update({ where: { id: row.id }, data: { status: "REJECTED", validationCode: "ai_action_stale" } }));
      }
      return dto(await db.aiActionProposal.update({ where: { id: row.id }, data: {
        status: "CONFIRMED", executionDeviceId: deviceId, confirmedAt: now() } }));
    });
  }
  async function cancel({ userId, actionId }) {
    return transaction(async (db) => {
      const row = await owned(db, userId, actionId);
      if (row.status === "CANCELLED") return dto(row);
      if (row.status !== "VALIDATED") throw new AppError("A execucao ja foi solicitada ou esta sugestao terminou.", 409, "ai_action_not_cancellable");
      return dto(await db.aiActionProposal.update({ where: { id: row.id }, data: { status: "CANCELLED", cancelledAt: now() } }));
    });
  }
  async function complete({ userId, actionId }) {
    return transaction(async (db) => {
      const row = await owned(db, userId, actionId);
      if (row.status === "EXECUTED") return dto(row);
      if (row.status !== "CONFIRMED") throw new AppError("Confirme a sugestao primeiro.", 409, "ai_action_confirmation_required");
      const planId = row.actionType === "USE_GENERATED_WORKOUT" ? row.payload.workout.id : row.payload.planId;
      let snapshot;
      try { snapshot = await loadSnapshot(db, userId, planId, row.actionType === "USE_GENERATED_WORKOUT" ?
        new Set(row.expectedAfter.exercicios.map((e) => e.id)) : undefined); } catch (e) {
        if (!(e instanceof AppError)) throw e;
        return dto(row);
      }
      // The app cannot assert EXECUTED. Only a canonical sync read proves the remote result.
      if (row.expectedAfter && digest(snapshot) !== digest(row.expectedAfter)) return dto(row);
      if (!row.expectedAfter) return dto(row);
      return dto(await db.aiActionProposal.update({ where: { id: row.id }, data: { status: "EXECUTED", executedAt: now(), resultReference: planId } }));
    });
  }
  async function get({ userId, actionId }) { return dto(await owned(client, userId, actionId)); }
  async function forMessages({ userId, messageIds }) {
    return client.aiActionProposal ? (await client.aiActionProposal.findMany({ where: { userId, sourceMessageId: { in: messageIds } }, orderBy: { ordinal: "asc" } })).map(dto) : [];
  }
  async function context({ userId, task }) {
    if (!client.aiActionProposal || task === "running_advice") return { available: false };
    try {
    const plans = await withDeadline(() => client.workout.findMany({ where: { userId, deletedAt: null }, orderBy: [{ updatedAt: "desc" }, { id: "asc" }], take: 2, include }), 5000);
    const safePlans = [];
    for (const plan of plans) { try {
      const snapshot = planSnapshot(plan);
      if (!/^[a-zA-Z0-9_-]{1,160}$/.test(snapshot.id) || snapshot.id.startsWith("eyJ")) continue;
      // Free-text names, notes and instructions remain in the owner-only preview,
      // not in the automatic provider context. IDs/numeric prescriptions suffice.
      safePlans.push({ planId: snapshot.id, days: snapshot.planoDias.map((d) => ({ dayOrder: d.ordem, exerciseIds: d.exercicioIds })),
        exercises: snapshot.exercicios.map((e) => ({ canonicalExerciseId: e.id, sets: e.series, restSeconds: e.descansoSegundos })) });
    } catch (e) {
      if (!(e instanceof AppError)) throw e; // Unsupported legacy definitions are not mutation targets.
    } }
    const generation = await withDeadline(() => client.aiUsage.findFirst({ where: { userId, operation: AI_OPERATIONS.workout, status: "succeeded" }, orderBy: { completedAt: "desc" }, select: { id: true } }), 5000);
    const data = { available: true, plans: safePlans, generationRequestId: generation?.id || null, canonicalExerciseIds: projection.canonicalIds };
    return Buffer.byteLength(JSON.stringify(data)) <= 18000 ? data : { available: false, reason: "action_context_budget_exceeded" };
    } catch { return { available: false, reason: "action_context_unavailable" }; }
  }
  return { propose, confirm, cancel, complete, get, forMessages, context };
}
module.exports = { createActionService, expiryMs };
