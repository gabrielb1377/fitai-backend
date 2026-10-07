const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const createApp = require("../../src/app");
const env = require("../../src/config/env");
const { CONTRACT_VERSION } = require("../../src/modules/activity_sync/activity_sync.rules");

const databaseUrl = process.env.TEST_DATABASE_URL;
const enabled = process.env.RUN_ACTIVITY_SYNC_POSTGRES_TESTS === "1" && Boolean(databaseUrl);
const prisma = enabled
  ? new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) })
  : null;

test("ActivitySync/v2: runs, steps, ownership, cursor, tombstone e multi-device", { skip: !enabled }, async () => {
  const nonce = randomUUID();
  const userA = await createUser(`activity-a-${nonce}@fitia.test`);
  const userB = await createUser(`activity-b-${nonce}@fitia.test`);
  const tokenA = accessToken(userA);
  const tokenB = accessToken(userB);
  const server = createApp().listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const r1 = run(`r1-${nonce}`);
  const r2 = run(`r2-${nonce}`, "2026-10-05T12:00:00.000Z");
  try {
    const accepted = await post(base, tokenA, body({ runs: [r1] }));
    const retry = await post(base, tokenA, body({ runs: [r1] }));
    assert.equal(accepted.status, 200);
    assert.equal(accepted.body.ack.accepted.length, 1);
    assert.equal(retry.body.ack.alreadyApplied.length, 1);
    assert.equal(await prisma.runningHistory.count({
      where: { userId: userA.id, externalRunId: r1.runId }
    }), 1);

    const secondDevice = await post(base, tokenA, body({ runs: [r2] }, "device-b"));
    assert.equal(secondDevice.body.ack.accepted.length, 1);
    assert.equal(await prisma.runningHistory.count({ where: { userId: userA.id } }), 2);

    const invalidRoute = await post(base, tokenA, body({
      runs: [{ ...run(`bad-${nonce}`), route: [{ ...r1.route[0], latitude: 100 }] }]
    }));
    assert.equal(invalidRoute.body.ack.rejected[0].code, "invalid_run");

    const immutable = await post(base, tokenA, body({
      runs: [{ ...r1, mutationId: `${r1.mutationId}-changed`, distanceKm: 9 }]
    }));
    assert.equal(immutable.body.ack.rejected[0].code, "immutable_run_conflict");

    const step5000 = steps("2026-10-05", 5000, 1);
    const firstSteps = await post(base, tokenA, body({ steps: [step5000] }));
    const lostAckRetry = await post(base, tokenA, body({ steps: [step5000] }));
    assert.equal(firstSteps.body.ack.accepted.length, 1);
    assert.equal(lostAckRetry.body.ack.alreadyApplied.length, 1);
    assert.equal((await stepRow(userA.id)).steps, 5000);

    const step6200 = steps("2026-10-05", 6200, 2);
    const raised = await post(base, tokenA, body({ steps: [step6200] }, "device-a"));
    assert.equal(raised.body.ack.updated.length, 1);
    assert.equal((await stepRow(userA.id)).steps, 6200);

    const beforeCorrection = raised.body.state.revision;
    const step5900 = steps("2026-10-05", 5900, 3);
    const corrected = await post(base, tokenA, body({ steps: [step5900] }, "device-b"));
    assert.equal(corrected.body.ack.updated.length, 1);
    assert.equal((await stepRow(userA.id)).steps, 5900);
    assert.equal(await prisma.dailySteps.count({ where: { userId: userA.id } }), 1);

    const legacySteps = await legacyPost(base, tokenA, "/steps/sync", {
      clientId: "old-device",
      items: [{
        date: "2026-10-05",
        steps: 6200,
        goal: 10000,
        source: "health_connect",
        updatedAt: "2026-10-05T23:00:00.000Z"
      }]
    });
    assert.equal(legacySteps.status, 200);
    assert.equal((await stepRow(userA.id)).steps, 5900);

    const delta = await get(base, tokenA, beforeCorrection);
    assert.equal(delta.body.state.steps.length, 1);
    assert.equal(delta.body.state.steps[0].steps, 5900);

    const pullA = await get(base, tokenA, "0");
    const pullB = await get(base, tokenB, "0");
    assert.equal(pullA.body.state.runs.length, 2);
    assert.equal(pullA.body.state.steps.length, 1);
    assert.equal(pullA.body.state.runs[0].route[0].latitude, r1.route[0].latitude);
    assert.equal(pullB.body.state.runs.length, 0);
    assert.equal(pullB.body.state.steps.length, 0);

    const spoofed = await post(base, tokenA, { ...body({ runs: [run(`spoof-${nonce}`)] }), userId: userB.id });
    assert.equal(spoofed.status, 400);

    const tombstone = {
      ...r1,
      mutationId: `${r1.mutationId}-delete`,
      deletedAt: "2026-10-05T14:00:00.000Z"
    };
    const removed = await post(base, tokenA, body({ runs: [tombstone] }));
    assert.equal(
      removed.body.ack.updated.length,
      1,
      JSON.stringify(removed.body.ack)
    );
    const resurrect = await post(base, tokenA, body({
      runs: [{ ...r1, mutationId: `${r1.mutationId}-resurrect` }]
    }));
    assert.equal(resurrect.body.ack.rejected[0].code, "immutable_run_conflict");

    const legacyRun = await legacyPost(base, tokenA, "/sync/running", {
      clientId: "old-device",
      items: [{
        id: r1.runId,
        data: r1.finishedAt,
        startTime: r1.startedAt,
        endTime: r1.finishedAt,
        distancia: 8,
        segundos: r1.durationSeconds
      }]
    });
    assert.equal(legacyRun.status, 200, JSON.stringify(legacyRun.body));
    const tombstonedRow = await prisma.runningHistory.findUnique({
      where: { userId_externalRunId: { userId: userA.id, externalRunId: r1.runId } }
    });
    assert.ok(tombstonedRow.deletedAt);
    assert.equal(tombstonedRow.distanceKm, r1.distanceKm);

    assert.equal(await prisma.progressionXpEvent.count({ where: { userId: userA.id } }), 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await prisma.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } });
  }
});

test.after(async () => { if (prisma) await prisma.$disconnect(); });

test("FITAI-12: canonical progress survives PostgreSQL, ACK, retry and device B pull", { skip: !enabled }, async () => {
  const nonce = randomUUID();
  const user = await createUser(`metrics-${nonce}@fitia.test`);
  const token = accessToken(user);
  const server = createApp().listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const value = run(`metrics-${nonce}`);
  value.route = [0, 1, 2, 3, 4, 5].map((distance) => ({
    ...value.route[0],
    timestamp: new Date(new Date(value.startedAt).getTime() + distance * 360000).toISOString(),
    cumulativeDistanceKm: distance,
    activeElapsedSeconds: distance * 360,
    startsSegment: distance === 0
  }));
  try {
    const accepted = await post(base, token, body({ runs: [value] }));
    assert.equal(accepted.body.ack.accepted.length, 1);
    const retry = await post(base, token, body({ runs: [value] }));
    assert.equal(retry.body.ack.alreadyApplied.length, 1);
    const sameEntity = await post(base, token, body({ runs: [{ ...value, mutationId: `${value.mutationId}-same` }] }, "device-b"));
    assert.equal(sameEntity.body.ack.alreadyApplied.length, 1);
    assert.equal(sameEntity.body.ack.rejected.length, 0);
    const pulled = await get(base, token, "0");
    assert.deepEqual(pulled.body.state.runs[0].route, value.route);
    assert.equal(await prisma.runningHistory.count({ where: { userId: user.id } }), 1);
    assert.equal(await prisma.progressionXpEvent.count({ where: { userId: user.id } }), 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await prisma.user.deleteMany({ where: { id: user.id } });
  }
});

async function createUser(email) {
  return prisma.user.create({ data: { name: "Activity Integration", email, passwordHash: "unused" } });
}

function accessToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, typ: "access", jti: randomUUID() },
    env.jwtSecret,
    { expiresIn: "10m" }
  );
}

function run(runId, startedAt = "2026-10-05T10:00:00.000Z") {
  const start = new Date(startedAt);
  return {
    mutationId: `run:${runId}:v1`,
    runId,
    startedAt: start.toISOString(),
    finishedAt: new Date(start.getTime() + 1800000).toISOString(),
    durationSeconds: 1800,
    distanceKm: 5,
    averageSpeed: 10,
    paceMinutesPerKm: 6,
    route: [{
      latitude: -12.9714,
      longitude: -38.5014,
      accuracy: 5,
      altitude: 10,
      speed: 2.8,
      timestamp: new Date(start.getTime() + 60000).toISOString()
    }],
    calories: 320,
    steps: 6000,
    deletedAt: null
  };
}

function steps(dayKey, count, version) {
  return {
    mutationId: `steps:${dayKey}:v${version}`,
    dayKey,
    steps: count,
    goal: 10000,
    source: "health_connect",
    observedAt: `2026-10-05T${String(10 + version).padStart(2, "0")}:00:00.000Z`,
    clientVersion: version
  };
}

function body({ runs = [], steps = [] }, deviceId = "device-a") {
  return { contractVersion: CONTRACT_VERSION, deviceId, afterRevision: "0", runs, steps };
}

async function post(base, token, payload) {
  return request(`${base}/activities/sync`, { method: "POST", token, body: payload });
}

async function get(base, token, cursor) {
  return request(`${base}/activities/sync?contractVersion=${encodeURIComponent(CONTRACT_VERSION)}&afterRevision=${cursor}`, { token });
}

async function legacyPost(base, token, path, payload) {
  return request(`${base}${path}`, { method: "POST", token, body: payload });
}

async function request(url, { method = "GET", token, body: payload } = {}) {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: payload === undefined ? undefined : JSON.stringify(payload)
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

function stepRow(userId) {
  return prisma.dailySteps.findUnique({
    where: { userId_dayKey: { userId, dayKey: "2026-10-05" } }
  });
}
