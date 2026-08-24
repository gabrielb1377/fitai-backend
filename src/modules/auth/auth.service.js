const bcrypt = require("bcrypt");
const { createHash, randomUUID } = require("node:crypto");
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

  return createAuthPayload(user);
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

  return createAuthPayload(safeUser);
}

async function refreshUserSession(refreshToken) {
  const payload = verifyRefreshToken(refreshToken);
  const sessionId = String(payload.jti || "");
  if (!sessionId || !payload.sub) {
    throw invalidRefreshToken();
  }

  return prisma.$transaction(async (tx) => {
    const session = await tx.authRefreshSession.findUnique({
      where: { id: sessionId },
      include: { user: { select: userSelect } }
    });
    if (!session ||
        session.userId !== payload.sub ||
        session.tokenHash !== tokenHash(refreshToken) ||
        session.revokedAt ||
        session.expiresAt <= new Date()) {
      throw invalidRefreshToken();
    }

    const revoked = await tx.authRefreshSession.updateMany({
      where: { id: session.id, userId: payload.sub, revokedAt: null },
      data: { revokedAt: new Date() }
    });
    if (revoked.count !== 1) throw invalidRefreshToken();

    return createAuthPayload(session.user, tx);
  });
}

async function revokeUserSessions(userId) {
  await prisma.authRefreshSession.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() }
  });
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
    const payload = jwt.verify(token, env.jwtSecret);
    if (payload.typ && payload.typ !== "access") throw new Error("invalid_token_type");
    return payload;
  } catch (err) {
    throw new AppError("Token invalido ou expirado.", 401, "invalid_token");
  }
}

function verifyRefreshToken(token) {
  try {
    const payload = jwt.verify(token, env.jwtSecret);
    if (payload.typ !== "refresh" || !payload.jti || !payload.sub) {
      throw new Error("invalid_refresh_token_type");
    }
    return payload;
  } catch (err) {
    throw invalidRefreshToken();
  }
}

async function createAuthPayload(user, db = prisma) {
  const token = signAccessToken(user);
  const refreshToken = signRefreshToken(user);
  const refreshPayload = jwt.decode(refreshToken);
  await db.authRefreshSession.create({
    data: {
      id: refreshPayload.jti,
      userId: user.id,
      tokenHash: tokenHash(refreshToken),
      expiresAt: new Date(refreshPayload.exp * 1000)
    }
  });
  return { user, token, refreshToken };
}

function signAccessToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      typ: "access",
      // Keeps each access-token rotation distinguishable even within one second.
      jti: randomUUID()
    },
    env.jwtSecret,
    {
      expiresIn: env.jwtExpiresIn
    }
  );
}

function signRefreshToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      typ: "refresh",
      jti: randomUUID()
    },
    env.jwtSecret,
    { expiresIn: env.jwtRefreshExpiresIn }
  );
}

function tokenHash(token) {
  return createHash("sha256").update(token).digest("hex");
}

function invalidRefreshToken() {
  return new AppError("Refresh token invalido ou expirado.", 401, "invalid_refresh_token");
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
  refreshUserSession,
  revokeUserSessions,
  getAuthenticatedUser,
  verifyToken,
  verifyRefreshToken
};
