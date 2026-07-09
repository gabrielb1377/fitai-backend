const prisma = require("../../../config/prisma");
const AppError = require("../../../shared/errors/app-error");
const {
  PROFILE_SELECT,
  USER_SELECT,
  toUserDto,
  toUsersDto
} = require("../dto/user.dto");

function createUsersService(db = prisma) {
  return {
    listUsers: () => listUsers(db),
    getUserById: (id) => getUserById(id, db),
    updateUser: (id, data) => updateUser(id, data, db),
    deleteUser: (id) => deleteUser(id, db),
    getProfileByUserId: (userId) => getProfileByUserId(userId, db),
    updateProfileByUserId: (userId, data) => updateProfileByUserId(userId, data, db)
  };
}

async function listUsers(db = prisma) {
  const users = await db.user.findMany({
    select: USER_SELECT,
    orderBy: {
      createdAt: "desc"
    }
  });

  return toUsersDto(users);
}

async function getUserById(id, db = prisma) {
  const user = await db.user.findUnique({
    where: { id },
    select: USER_SELECT
  });

  if (!user) {
    throw new AppError("Usuario nao encontrado.", 404, "user_not_found");
  }

  return toUserDto(user);
}

async function updateUser(id, data, db = prisma) {
  await ensureUserExists(id, db);

  if (data.email) {
    await ensureEmailIsAvailable(id, data.email, db);
  }

  const user = await db.user.update({
    where: { id },
    data,
    select: USER_SELECT
  });

  return toUserDto(user);
}

async function deleteUser(id, db = prisma) {
  await ensureUserExists(id, db);

  await db.user.delete({
    where: { id }
  });
}

async function getProfileByUserId(userId, db = prisma) {
  const profile = await db.profile.findUnique({
    where: { userId },
    select: PROFILE_SELECT
  });

  if (!profile) {
    throw new AppError("Perfil nao encontrado.", 404, "profile_not_found");
  }

  return profile;
}

async function updateProfileByUserId(userId, data, db = prisma) {
  await getProfileByUserId(userId, db);

  return db.profile.update({
    where: { userId },
    data,
    select: PROFILE_SELECT
  });
}

async function ensureUserExists(id, db) {
  const user = await db.user.findUnique({
    where: { id },
    select: { id: true }
  });

  if (!user) {
    throw new AppError("Usuario nao encontrado.", 404, "user_not_found");
  }
}

async function ensureEmailIsAvailable(id, email, db) {
  const userWithEmail = await db.user.findUnique({
    where: { email },
    select: { id: true }
  });

  if (userWithEmail && userWithEmail.id !== id) {
    throw new AppError("Email ja cadastrado.", 409, "email_already_registered");
  }
}

module.exports = {
  createUsersService,
  listUsers,
  getUserById,
  updateUser,
  deleteUser,
  getProfileByUserId,
  updateProfileByUserId
};
