const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const enabled = process.env.RUN_AUTHORIZATION_OWNERSHIP_POSTGRES_TESTS === "1" && Boolean(testDatabaseUrl);
const prisma = enabled
  ? new PrismaClient({ adapter: new PrismaPg({ connectionString: testDatabaseUrl }) })
  : null;

let server;
let baseUrl;

test.before(async () => {
  if (!enabled) return;

  const createApp = require("../../src/app");
  server = createApp().listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test("PostgreSQL: Sync e Steps exigem JWT valido", { skip: !enabled }, async () => {
  const missingSync = await request("/sync/goals", { method: "POST", body: { items: [] } });
  const invalidSteps = await request("/steps/today", {
    headers: { Authorization: "Bearer token-invalido" }
  });

  assert.equal(missingSync.status, 401);
  assert.equal(missingSync.body.error, "missing_token");
  assert.equal(invalidSteps.status, 401);
  assert.equal(invalidSteps.body.error, "invalid_token");
});

test("PostgreSQL: dados de Sync e Steps pertencem somente ao JWT", { skip: !enabled }, async () => {
  await withUsers(async (userA, userB) => {
    const tokenA = bearer(userA);
    const tokenB = bearer(userB);
    const goalId = randomUUID();
    const date = "2026-08-17";

    const createGoal = await request("/sync/goals", {
      method: "POST",
      headers: { Authorization: tokenA },
      body: {
        clientId: "device-a",
        userId: userB.id,
        item: { id: goalId, title: "Meta da conta A", targetValue: 10 }
      }
    });
    assert.equal(createGoal.status, 200);
    assert.equal(createGoal.body.goals[0].userId, userA.id);

    const updateOwnGoalWithAnotherClient = await request("/sync/goals", {
      method: "POST",
      headers: { Authorization: tokenA },
      body: {
        clientId: "device-a-reinstalled",
        userId: userB.id,
        item: { id: goalId, title: "Meta da conta A atualizada", targetValue: 12 }
      }
    });
    assert.equal(updateOwnGoalWithAnotherClient.status, 200);
    assert.equal(updateOwnGoalWithAnotherClient.body.goals[0].userId, userA.id);

    const otherAccountCannotReuseGoalId = await request("/sync/goals", {
      method: "POST",
      headers: { Authorization: tokenB },
      body: { clientId: "device-b", item: { id: goalId, title: "Tentativa B", targetValue: 99 } }
    });
    assert.equal(otherAccountCannotReuseGoalId.status, 404);
    assert.equal(otherAccountCannotReuseGoalId.body.error, "resource_not_found");

    const goalsA = await request("/sync/goals", { headers: { Authorization: tokenA } });
    const goalsB = await request("/sync/goals", { headers: { Authorization: tokenB } });
    assert.equal(goalsA.body.goals.length, 1);
    assert.equal(goalsA.body.goals[0].title, "Meta da conta A atualizada");
    assert.equal(goalsA.body.goals[0].userId, userA.id);
    assert.equal(goalsB.body.goals.length, 0);

    const syncStepsA = await request("/steps/sync", {
      method: "POST",
      headers: { Authorization: tokenA },
      body: {
        clientId: "device-a",
        userId: userB.id,
        item: { date, steps: 8200, goal: 8000, source: "manual" }
      }
    });
    assert.equal(syncStepsA.status, 200);
    assert.equal(syncStepsA.body.steps[0].userId, userA.id);

    const stepsB = await request(`/steps/range?from=${date}&to=${date}`, {
      headers: { Authorization: tokenB }
    });
    assert.equal(stepsB.status, 200);
    assert.equal(stepsB.body.steps.length, 0);
  });
});

test("PostgreSQL: /users/:id permite apenas o proprietario e rejeita mass assignment", { skip: !enabled }, async () => {
  await withUsers(async (userA, userB) => {
    const tokenA = bearer(userA);
    const tokenB = bearer(userB);

    const ownRead = await request(`/users/${userA.id}`, { headers: { Authorization: tokenA } });
    const forbiddenRead = await request(`/users/${userA.id}`, { headers: { Authorization: tokenB } });
    const forbiddenWrite = await request(`/users/${userA.id}`, {
      method: "PATCH",
      headers: { Authorization: tokenB },
      body: { name: "Nao deve atualizar" }
    });
    const massAssignment = await request(`/users/${userA.id}`, {
      method: "PATCH",
      headers: { Authorization: tokenA },
      body: { name: "Conta A", userId: userB.id, role: "admin" }
    });

    assert.equal(ownRead.status, 200);
    assert.equal(forbiddenRead.status, 403);
    assert.equal(forbiddenWrite.status, 403);
    assert.equal(massAssignment.status, 400);

    const stored = await prisma.user.findUnique({ where: { id: userA.id } });
    assert.equal(stored.name, userA.name);
  });
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (prisma) await prisma.$disconnect();
});

async function request(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method || "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  return { status: response.status, body: await response.json() };
}

async function withUsers(callback) {
  const suffix = randomUUID();
  const userA = await createUser(`authorization-a-${suffix}@fitia.test`, "Conta A");
  const userB = await createUser(`authorization-b-${suffix}@fitia.test`, "Conta B");
  try {
    return await callback(userA, userB);
  } finally {
    await prisma.user.delete({ where: { id: userA.id } });
    await prisma.user.delete({ where: { id: userB.id } });
  }
}

function createUser(email, name) {
  return prisma.user.create({ data: { email, name, passwordHash: "not-used-by-integration-test" } });
}

function bearer(user) {
  return `Bearer ${jwt.sign({ sub: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: "1h" })}`;
}
