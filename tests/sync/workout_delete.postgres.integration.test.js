const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const {
  syncWorkouts,
  getWorkouts,
  deleteWorkout,
  deleteWorkoutById
} = require("../../src/modules/sync/sync.service");

const databaseUrl = process.env.TEST_DATABASE_URL;
const enabled = process.env.RUN_R2_3A_POSTGRES_TESTS === "1" && Boolean(databaseUrl);
const prisma = enabled
  ? new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) })
  : null;

test("PostgreSQL: definicao de plano usa tombstone idempotente e preserva historico", { skip: !enabled }, async () => {
  const owner = await createUser("owner");
  const otherUser = await createUser("other");
  const workoutId = randomUUID();
  const ownerRequest = { auth: { userId: owner.id }, clientId: "device-owner" };

  try {
    await syncWorkouts(ownerRequest, {}, [workoutPayload(workoutId)]);
    const listedBeforeDelete = await getWorkouts(ownerRequest);
    assert.equal(listedBeforeDelete.workouts.some((workout) => workout.id === workoutId), true);

    await prisma.workoutHistory.create({
      data: {
        userId: owner.id,
        workoutId,
        startedAt: new Date("2026-08-26T10:00:00.000Z"),
        finishedAt: new Date("2026-08-26T10:30:00.000Z"),
        totalVolume: 1200,
        totalSets: 4,
        durationSeconds: 1800
      }
    });

    const firstDelete = await deleteWorkout(ownerRequest, workoutId);
    const replay = await deleteWorkoutById(owner.id, workoutId);
    const otherUserDelete = await deleteWorkout(
      { auth: { userId: otherUser.id }, clientId: "forged-owner-device" },
      workoutId
    );

    assert.deepEqual(firstDelete, { id: workoutId, deleted: true, alreadyDeleted: false });
    assert.deepEqual(replay, { id: workoutId, deleted: false, alreadyDeleted: true });
    assert.deepEqual(otherUserDelete, { id: workoutId, deleted: false, alreadyDeleted: true });

    const listedAfterDelete = await getWorkouts(ownerRequest);
    const persisted = await prisma.workout.findUnique({
      where: { id: workoutId },
      select: { userId: true, deletedAt: true }
    });

    assert.equal(listedAfterDelete.workouts.some((workout) => workout.id === workoutId), false);
    assert.equal(persisted.userId, owner.id);
    assert.ok(persisted.deletedAt instanceof Date);
    assert.equal(await prisma.workoutHistory.count({ where: { workoutId } }), 1);
  } finally {
    await prisma.user.deleteMany({ where: { id: { in: [owner.id, otherUser.id] } } });
  }
});

test.after(async () => {
  if (prisma) await prisma.$disconnect();
});

async function createUser(label) {
  const suffix = randomUUID();
  return prisma.user.create({
    data: {
      name: `R2.3A ${label}`,
      email: `r2-3a-${label}-${suffix}@fitia.test`,
      passwordHash: "not-used-by-integration-test"
    }
  });
}

function workoutPayload(id) {
  return {
    id,
    nome: "Plano R2.3A",
    descricao: "Plano efemero de validacao PostgreSQL.",
    objetivo: "forca",
    nivel: "intermediario",
    divisao: "Upper Lower",
    diasPorSemana: 2,
    tempoEstimado: 45,
    exercicios: [],
    planoDias: []
  };
}
