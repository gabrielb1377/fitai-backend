const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");

const baseUrl = process.env.R1_5_BASE_URL;
const databaseUrl = process.env.TEST_DATABASE_URL;
const enabled = Boolean(baseUrl && databaseUrl);
const prisma = enabled ? new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) }) : null;
const suffix = randomUUID();
const email = `r15-auth-${suffix}@fitia.test`;

test("R1.5: access, refresh com rotacao e logout revogado usam PostgreSQL", { skip: !enabled }, async () => {
  const registered = await request("/auth/register", {
    method: "POST",
    body: { name: "R1.5 Auth", email, password: "r1-5-auth-password" }
  });
  assert.equal(registered.status, 201);
  assert.ok(registered.body.token);
  assert.ok(registered.body.refreshToken);

  const access = await request("/auth/me", { headers: { Authorization: `Bearer ${registered.body.token}` } });
  assert.equal(access.status, 200);
  assert.equal(access.body.user.email, email);

  const refreshed = await request("/auth/refresh", {
    method: "POST",
    body: { refreshToken: registered.body.refreshToken }
  });
  assert.equal(refreshed.status, 200);
  assert.notEqual(refreshed.body.token, registered.body.token);
  assert.notEqual(refreshed.body.refreshToken, registered.body.refreshToken);

  const replay = await request("/auth/refresh", {
    method: "POST",
    body: { refreshToken: registered.body.refreshToken }
  });
  assert.equal(replay.status, 401);
  assert.equal(replay.body.error, "invalid_refresh_token");

  const logout = await request("/auth/logout", {
    method: "POST",
    headers: { Authorization: `Bearer ${refreshed.body.token}` }
  });
  assert.equal(logout.status, 204);

  const revoked = await request("/auth/refresh", {
    method: "POST",
    body: { refreshToken: refreshed.body.refreshToken }
  });
  assert.equal(revoked.status, 401);

  const user = await prisma.user.findUnique({ where: { email } });
  const activeRefreshes = await prisma.authRefreshSession.count({ where: { userId: user.id, revokedAt: null } });
  assert.equal(activeRefreshes, 0);
});

test("R1.5: copiar plano pronto exige JWT e nunca cria owner por clientId", { skip: !enabled }, async () => {
  const response = await request(`/ready-plans/${randomUUID()}/copy`, {
    method: "POST",
    headers: { "X-FitIA-Client-Id": "forged-device" }
  });
  assert.equal(response.status, 401);
  assert.equal(response.body.error, "missing_token");
});

test.after(async () => {
  if (!prisma) return;
  await prisma.user.deleteMany({ where: { email } });
  await prisma.$disconnect();
});

async function request(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method || "GET", headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : {} };
}
