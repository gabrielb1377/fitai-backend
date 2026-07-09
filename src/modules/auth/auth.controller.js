const AppError = require("../../shared/errors/app-error");
const {
  registerUser,
  loginUser,
  getAuthenticatedUser
} = require("./auth.service");
const {
  registerSchema,
  loginSchema,
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
  meController
};
