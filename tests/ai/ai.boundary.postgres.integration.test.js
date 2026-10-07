const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");

const baseUrl = process.env.R1_6_BASE_URL;
const databaseUrl = process.env.TEST_DATABASE_URL;
const enabled = Boolean(baseUrl && databaseUrl);
const prisma = enabled ? new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) }) : null;
const suffix = randomUUID();
const userA = `r16-a-${suffix}@fitia.test`;
const userB = `r16-b-${suffix}@fitia.test`;
const userC = `r16-c-${suffix}@fitia.test`;

test("AI-01/02: endpoints de IA rejeitam token ausente ou invalido", { skip: !enabled }, async () => {
  const missing = await request("/ai/generate-workout", { method: "POST", body: workoutInput() });
  assert.equal(missing.status, 401);
  const invalid = await request("/coach/insights", {
    method: "POST",
    headers: { Authorization: "Bearer invalido", "Idempotency-Key": key("invalid") },
    body: {}
  });
  assert.equal(invalid.status, 401);
});

test("AI-03/04/05/06/08/09: ownership, quota e replay sao server-authoritative", { skip: !enabled }, async () => {
  const a = await register(userA);
  const b = await register(userB);
  const intentKey = key("owner");
  const input = { ...workoutInput(), userId: b.user.id, clientId: "forged-device" };
  const generated = await request("/ai/generate-workout", {
    method: "POST",
    headers: authHeaders(a.token, intentKey),
    body: input
  });
  assert.equal(generated.status, 200);

  const usage = await prisma.aiUsage.findFirst({ where: { userId: a.user.id, idempotencyKey: intentKey } });
  assert.ok(usage);
  assert.equal(usage.userId, a.user.id);

  const replay = await request("/ai/generate-workout", {
    method: "POST",
    headers: authHeaders(a.token, intentKey),
    body: input
  });
  assert.equal(replay.status, 200);
  assert.equal(replay.headers.get("idempotent-replay"), "true");
  assert.equal(await prisma.aiUsage.count({ where: { userId: a.user.id, operation: "workout_generation" } }), 1);

  const tampered = await request("/ai/generate-workout", {
    method: "POST",
    headers: authHeaders(a.token, intentKey),
    body: { ...input, tempoPorTreino: 60 }
  });
  assert.equal(tampered.status, 409);
});

test("AI-07/10: quota nao e ultrapassada sob concorrencia", { skip: !enabled }, async () => {
  const account = await register(userC);
  const responses = await Promise.all([
    request("/coach/insights", { method: "POST", headers: authHeaders(account.token, key("concurrent-a")), body: {} }),
    request("/coach/insights", { method: "POST", headers: authHeaders(account.token, key("concurrent-b")), body: {} })
  ]);
  const statuses = responses.map((response) => response.status).sort();
  assert.deepEqual(statuses, [200, 429], JSON.stringify(responses.map((response) => response.body)));
  assert.equal(await prisma.aiUsage.count({ where: { userId: account.user.id, operation: "coach_insights", status: "succeeded" } }), 1);
});

test.after(async () => {
  if (!prisma) return;
  await prisma.user.deleteMany({ where: { email: { in: [userA, userB, userC] } } });
  await prisma.$disconnect();
});

function workoutInput() {
  return {
    objetivo: "hipertrofia", divisao: "ABC", nivel: "iniciante", diasPorSemana: 3,
    tempoPorTreino: 45, local: "academia", equipamentos: ["halteres"],
    restricoes: [], prioridades: [], minExerciciosPorDia: 6, observacoes: ""
  };
}

function key(label) { return `r16-${label}-${randomUUID()}`; }

function authHeaders(token, idempotencyKey) {
  return { Authorization: `Bearer ${token}`, "Idempotency-Key": idempotencyKey };
}

async function register(email) {
  const response = await request("/auth/register", {
    method: "POST", body: { name: "R1.6 AI", email, password: "r1-6-ai-password" }
  });
  assert.equal(response.status, 201);
  return response.body;
}

async function request(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method || "GET", headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const text = await response.text();
  return { status: response.status, headers: response.headers, body: text ? JSON.parse(text) : {} };
}
