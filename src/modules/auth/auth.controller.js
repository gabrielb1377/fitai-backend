const AppError = require("../../shared/errors/app-error");
const {
  registerUser,
  loginUser,
  refreshUserSession,
  revokeUserSessions,
  getAuthenticatedUser
} = require("./auth.service");
const {
  registerSchema,
  loginSchema,
  refreshSchema,
  formatZodErrors
} = require("./auth.schemas");

async function registerController(req, res) {
  const input = parseBody(registerSchema, req.body);
  const result = await registerUser(input);

  return res.status(201).json(result);
}

async function loginController(req, res) {
  const input = parseBody(loginSchema, req.body);
  const result = await loginUser(input);

  return res.status(200).json(result);
}

async function refreshController(req, res) {
  const input = parseBody(refreshSchema, req.body);
  const result = await refreshUserSession(input.refreshToken);
  return res.status(200).json(result);
}

async function logoutController(req, res) {
  await revokeUserSessions(req.auth.userId);
  return res.status(204).send();
}

async function meController(req, res) {
  const user = await getAuthenticatedUser(req.auth.userId);

  return res.status(200).json({
    user
  });
}

function parseBody(schema, body) {
  const result = schema.safeParse(body);

  if (!result.success) {
    throw new AppError("Body invalido.", 400, "invalid_request", formatZodErrors(result.error));
  }

  return result.data;
}

module.exports = {
  registerController,
  loginController,
  refreshController,
  logoutController,
  meController
};
