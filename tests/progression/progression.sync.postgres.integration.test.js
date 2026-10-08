const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const createApp = require("../../src/app");
const env = require("../../src/config/env");
const {
  CONTRACT_VERSION,
  RULES_VERSION
} = require("../../src/modules/progression/progression.sync.rules");

const databaseUrl = process.env.TEST_DATABASE_URL;
const enabled = process.env.RUN_PROGRESSION_SYNC_POSTGRES_TESTS === "1" && Boolean(databaseUrl);
const prisma = enabled
  ? new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) })
  : null;

test("PostgreSQL: auth, ownership, unique, ACK, pull e multi-device", { skip: !enabled }, async () => {
  const runId = randomUUID();
  const userA = await createUser(`progression-a-${runId}@fitia.test`);
  const userB = await createUser(`progression-b-${runId}@fitia.test`);
  const tokenA = accessToken(userA);
  const tokenB = accessToken(userB);
  const source = await seedSources(userA, userB, runId);
  const server = createApp().listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const missing = await request(baseUrl, "/progression/sync/events", {
      method: "POST",
      body: pushBody(event("workout", source.workoutA))
    });
    const invalid = await request(baseUrl, "/progression/sync", {
      headers: { Authorization: "Bearer invalid" }
    });
    assert.equal(missing.status, 401);
    assert.equal(invalid.status, 401);

    const workout = event("workout", source.workoutA, "workout-event-a");
    const accepted = await request(baseUrl, "/progression/sync/events", {
      method: "POST",
      headers: bearer(tokenA),
      body: pushBody(workout, "device-a")
    });
    const retry = await request(baseUrl, "/progression/sync/events", {
      method: "POST",
      headers: bearer(tokenA),
      body: pushBody(workout, "device-a")
    });
    assert.equal(accepted.status, 200);
    assert.equal(accepted.body.ack.accepted[0].xpAwarded, 15);
    assert.equal(retry.body.ack.alreadyApplied.length, 1);

    const run = await request(baseUrl, "/progression/sync/events", {
      method: "POST",
      headers: bearer(tokenA),
      body: pushBody(event("running", source.runA), "device-b")
    });
    assert.equal(run.body.state.balance.totalXp, 25);

    const steps = await request(baseUrl, "/progression/sync/events", {
      method: "POST",
      headers: bearer(tokenA),
      body: pushBody(event("stepsGoal", source.stepsDate), "device-a")
    });
    assert.equal(steps.body.ack.accepted[0].xpAwarded, 8);
    assert.equal(steps.body.state.balance.totalXp, 33);

    const sharedSource = source.workoutConcurrent;
    const [concurrentA, concurrentB] = await Promise.all([
      request(baseUrl, "/progression/sync/events", {
        method: "POST",
        headers: bearer(tokenA),
        body: pushBody(event("workout", sharedSource, "concurrent-a"), "device-a")
      }),
      request(baseUrl, "/progression/sync/events", {
        method: "POST",
        headers: bearer(tokenA),
        body: pushBody(event("workout", sharedSource, "concurrent-b"), "device-b")
      })
    ]);
    const acceptedCount = concurrentA.body.ack.accepted.length + concurrentB.body.ack.accepted.length;
    const duplicateCount = concurrentA.body.ack.alreadyApplied.length + concurrentB.body.ack.alreadyApplied.length;
    assert.equal(acceptedCount, 1);
    assert.equal(duplicateCount, 1);

    const foreign = await request(baseUrl, "/progression/sync/events", {
      method: "POST",
      headers: bearer(tokenA),
      body: pushBody(event("running", source.runB, "foreign-run"))
    });
    assert.equal(foreign.body.ack.rejected[0].code, "source_not_found");

    const spoofed = await request(baseUrl, "/progression/sync/events", {
      method: "POST",
      headers: bearer(tokenA),
      body: { ...pushBody(event("running", source.runA)), userId: userB.id }
    });
    assert.equal(spoofed.status, 400);

    const invalidSource = await request(baseUrl, "/progression/sync/events", {
      method: "POST",
      headers: bearer(tokenA),
      body: pushBody({ ...event("workout", source.workoutA), sourceType: "unknown" })
    });
    assert.equal(invalidSource.body.ack.rejected[0].code, "invalid_progression_event");

    const invalidRules = await request(baseUrl, "/progression/sync/events", {
      method: "POST",
      headers: bearer(tokenA),
      body: {
        ...pushBody({ ...event("workout", source.workoutA), rulesVersion: 99 }),
        rulesVersion: 99
      }
    });
    assert.equal(invalidRules.body.ack.rejected[0].code, "unsupported_rules_version");

    const pullA = await request(
      baseUrl,
      `/progression/sync?contractVersion=${encodeURIComponent(CONTRACT_VERSION)}&afterRevision=0`,
      { headers: bearer(tokenA) }
    );
    const pullB = await request(
      baseUrl,
      `/progression/sync?contractVersion=${encodeURIComponent(CONTRACT_VERSION)}&afterRevision=0`,
      { headers: bearer(tokenB) }
    );
    assert.equal(pullA.body.state.balance.totalXp, 48);
    assert.equal(pullA.body.state.events.length, 4);
    assert.equal(pullB.body.state.balance.totalXp, 0);
    assert.equal(pullB.body.state.events.length, 0);
    assert.equal(await prisma.progressionXpEvent.count({ where: { userId: userA.id } }), 4);
    assert.equal(await prisma.progressionXpEvent.count({ where: { userId: userB.id } }), 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await prisma.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } });
  }
});

test.after(async () => {
  if (prisma) await prisma.$disconnect();
});

async function createUser(email) {
  return prisma.user.create({
    data: { name: "Progression Integration", email, passwordHash: "not-used" }
  });
}

async function seedSources(userA, userB, runId) {
  const workoutA = `workout-a-${runId}`;
  const workoutConcurrent = `workout-c-${runId}`;
  const runA = `run-a-${runId}`;
  const runB = `run-b-${runId}`;
  const stepsDate = "2026-10-04";
  await prisma.workoutSyncSession.createMany({
    data: [workoutA, workoutConcurrent].map((externalSessionId) => ({
      userId: userA.id,
      externalSessionId,
      planId: `plan-${runId}`,
      workoutId: `definition-${externalSessionId}`,
      status: "completed",
      startedAt: new Date("2026-10-04T09:00:00.000Z"),
      finishedAt: new Date("2026-10-04T10:00:00.000Z")
    }))
  });
  await prisma.runningHistory.createMany({
    data: [
      {
        id: runA,
        userId: userA.id,
        externalRunId: runA,
        distanceKm: 5,
        durationSeconds: 1800,
        averageSpeed: 10,
        paceMinutesPerKm: 6,
        route: [],
        startedAt: new Date("2026-10-04T10:30:00.000Z"),
        finishedAt: new Date("2026-10-04T11:00:00.000Z"),
        performedAt: new Date("2026-10-04T11:00:00.000Z")
      },
      {
        id: runB,
        userId: userB.id,
        externalRunId: runB,
        distanceKm: 3,
        durationSeconds: 1200,
        averageSpeed: 9,
        paceMinutesPerKm: 6.6666666667,
        route: [],
        startedAt: new Date("2026-10-04T10:40:00.000Z"),
        finishedAt: new Date("2026-10-04T11:00:00.000Z"),
        performedAt: new Date("2026-10-04T11:00:00.000Z")
      }
    ]
  });
  await prisma.dailySteps.create({
    data: {
      userId: userA.id,
      date: new Date(`${stepsDate}T00:00:00.000Z`),
      dayKey: stepsDate,
      steps: 10000,
      goal: 10000,
      source: "manual",
      deviceId: "integration-seed",
      observedAt: new Date(`${stepsDate}T12:00:00.000Z`)
    }
  });
  return { workoutA, workoutConcurrent, runA, runB, stepsDate };
}

function accessToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, typ: "access", jti: randomUUID() },
    env.jwtSecret,
    { expiresIn: "10m" }
  );
}

function bearer(token) {
  return { Authorization: `Bearer ${token}` };
}

function event(sourceType, sourceId, eventId = `${sourceType}:${sourceId}`) {
  return {
    eventId,
    sourceType,
    sourceId,
    occurredAt: "2026-10-04T12:00:00.000Z",
    rulesVersion: RULES_VERSION
  };
}

function pushBody(item, deviceId = "integration-device") {
  return {
    contractVersion: CONTRACT_VERSION,
    rulesVersion: RULES_VERSION,
    deviceId,
    afterRevision: "0",
    events: [item]
  };
}

async function request(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) : null
  };
}
