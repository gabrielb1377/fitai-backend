const AppError = require("../../../shared/errors/app-error");
const {
  listUsers,
  getUserById,
  updateUser,
  deleteUser,
  getProfileByUserId,
  updateProfileByUserId
} = require("../service/users.service");
const {
  userIdParamsSchema,
  updateUserSchema,
  updateProfileSchema,
  formatZodErrors
} = require("../schemas/users.schemas");

async function listUsersController(req, res) {
  const users = await listUsers();

  return res.status(200).json({
    users
  });
}

async function getUserController(req, res) {
  const { id } = parseParams(req.params);
  const user = await getUserById(id);

  return res.status(200).json({
    user
  });
}

async function updateUserController(req, res) {
  const { id } = parseParams(req.params);
  const input = parseBody(updateUserSchema, req.body);
  const user = await updateUser(id, input);

  return res.status(200).json({
    user
  });
}

async function deleteUserController(req, res) {
  const { id } = parseParams(req.params);

  await deleteUser(id);

  return res.status(204).send();
}

async function getProfileController(req, res) {
  const profile = await getProfileByUserId(req.auth.userId);

  return res.status(200).json({
    profile
  });
}

async function updateProfileController(req, res) {
  const input = parseBody(updateProfileSchema, req.body);
  const profile = await updateProfileByUserId(req.auth.userId, input);

  return res.status(200).json({
    profile
  });
}

function parseParams(params) {
  const result = userIdParamsSchema.safeParse(params);

  if (!result.success) {
    throw new AppError("Parametros invalidos.", 400, "invalid_params", formatZodErrors(result.error));
  }

  return result.data;
}

function parseBody(schema, body) {
  const result = schema.safeParse(body);

  if (!result.success) {
    throw new AppError("Body invalido.", 400, "invalid_request", formatZodErrors(result.error));
  }

  return result.data;
}

module.exports = {
  listUsersController,
  getUserController,
  updateUserController,
  deleteUserController,
  getProfileController,
  updateProfileController
};
