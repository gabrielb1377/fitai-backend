const test = require("node:test");
const assert = require("node:assert/strict");
const AppError = require("../../src/shared/errors/app-error");
const { createUsersService } = require("../../src/modules/users/service/users.service");

const baseUser = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Gabriel",
  email: "gabriel@email.com",
  passwordHash: "hash",
  createdAt: new Date("2026-07-08T00:00:00.000Z"),
  updatedAt: new Date("2026-07-08T00:00:00.000Z"),
  profile: {
    id: "22222222-2222-4222-8222-222222222222",
    userId: "11111111-1111-4111-8111-111111111111",
    weight: 80,
    height: 180,
    age: 30,
    goal: "hipertrofia",
    level: "intermediario",
    createdAt: new Date("2026-07-08T00:00:00.000Z"),
    updatedAt: new Date("2026-07-08T00:00:00.000Z")
  }
};

test("listUsers never returns passwordHash", async () => {
  const service = createUsersService({
    user: {
      findMany: async () => [baseUser]
    }
  });

  const users = await service.listUsers();

  assert.equal(users.length, 1);
  assert.equal(users[0].passwordHash, undefined);
});

test("getUserById throws standardized not found error", async () => {
  const service = createUsersService({
    user: {
      findUnique: async () => null
    }
  });

  await assert.rejects(
    () => service.getUserById("33333333-3333-4333-8333-333333333333"),
    (err) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 404);
      assert.equal(err.code, "user_not_found");
      return true;
    }
  );
});

test("updateUser rejects email already used by another user", async () => {
  const service = createUsersService({
    user: {
      findUnique: async ({ where }) => {
        if (where.id) {
          return { id: where.id };
        }

        if (where.email) {
          return { id: "44444444-4444-4444-8444-444444444444" };
        }

        return null;
      }
    }
  });

  await assert.rejects(
    () => service.updateUser(baseUser.id, { email: "outro@email.com" }),
    (err) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 409);
      assert.equal(err.code, "email_already_registered");
      return true;
    }
  );
});

test("updateProfileByUserId updates the authenticated user's profile", async () => {
  const service = createUsersService({
    profile: {
      findUnique: async () => baseUser.profile,
      update: async ({ data }) => ({
        ...baseUser.profile,
        ...data
      })
    }
  });

  const profile = await service.updateProfileByUserId(baseUser.id, {
    weight: 82,
    goal: "forca"
  });

  assert.equal(profile.weight, 82);
  assert.equal(profile.goal, "forca");
});
