const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const prisma = require("../../config/prisma");
const env = require("../../config/env");
const AppError = require("../../shared/errors/app-error");

const SALT_ROUNDS = 10;

const userSelect = {
  id: true,
  name: true,
  email: true,
  createdAt: true,
  updatedAt: true,
  profile: {
    select: {
      id: true,
      userId: true,
      weight: true,
      height: true,
      age: true,
      goal: true,
      level: true,
      createdAt: true,
      updatedAt: true
    }
  }
};

async function registerUser(input) {
  const existingUser = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true }
  });

  if (existingUser) {
    throw new AppError("Email ja cadastrado.", 409, "email_already_registered");
  }

  const passwordHash = await bcrypt.hash(input.password, SALT_ROUNDS);

  const user = await prisma.user.create({
    data: {
      name: input.name,
      email: input.email,
      passwordHash,
      profile: {
        create: buildInitialProfile()
      }
    },
    select: userSelect
  });

  return {
    user,
    token: signToken(user)
  };
}

async function loginUser(input) {
  const user = await prisma.user.findUnique({
    where: { email: input.email },
    include: {
      profile: true
    }
  });

  if (!user) {
    throw new AppError("Credenciais invalidas.", 401, "invalid_credentials");
  }

  const passwordMatches = await bcrypt.compare(input.password, user.passwordHash);

  if (!passwordMatches) {
    throw new AppError("Credenciais invalidas.", 401, "invalid_credentials");
  }

  const safeUser = removePasswordHash(user);

  return {
    user: safeUser,
    token: signToken(safeUser)
  };
}

async function getAuthenticatedUser(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: userSelect
  });

  if (!user) {
    throw new AppError("Usuario autenticado nao encontrado.", 404, "authenticated_user_not_found");
  }

  return user;
}

function verifyToken(token) {
  try {
    return jwt.verify(token, env.jwtSecret);
  } catch (err) {
    throw new AppError("Token invalido ou expirado.", 401, "invalid_token");
  }
}

function signToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email
    },
    env.jwtSecret,
    {
      expiresIn: env.jwtExpiresIn
    }
  );
}

function buildInitialProfile() {
  return {
    weight: 0,
    height: 0,
    age: 0,
    goal: "",
    level: ""
  };
}

function removePasswordHash(user) {
  const { passwordHash, ...safeUser } = user;

  return safeUser;
}

module.exports = {
  registerUser,
  loginUser,
  getAuthenticatedUser,
  verifyToken
};
