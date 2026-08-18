const prisma = require("../../config/prisma");
const AppError = require("../../shared/errors/app-error");

async function syncSteps(req, payload, items, db = prisma) {
  const user = await resolveAuthenticatedUser(req, db);
  const synced = [];

  for (const item of items) {
    const dateKey = normalizeDateKey(item.date);
    if (!dateKey) continue;

    const date = dateFromKey(dateKey);
    const existing = await db.dailySteps.findUnique({
      where: { userId_date: { userId: user.id, date } }
    });
    const incoming = normalizeStepItem(item, date);
    const merged = reconcileStepRecord(existing, incoming);

    synced.push(await db.dailySteps.upsert({
      where: { userId_date: { userId: user.id, date } },
      update: {
        steps: merged.steps,
        goal: merged.goal,
        source: merged.source
      },
      create: {
        userId: user.id,
        date,
        steps: merged.steps,
        goal: merged.goal,
        source: merged.source
      }
    }));
  }

  logSteps(`sync count=${synced.length} user=${user.id}`);

  return {
    user: safeUser(user),
    steps: synced.map(toDto)
  };
}

async function getToday(req, payload = {}, db = prisma) {
  const user = await resolveAuthenticatedUser(req, db);
  const date = dateFromKey(normalizeDateKey(new Date()));
  const record = await db.dailySteps.findUnique({
    where: { userId_date: { userId: user.id, date } }
  });

  return {
    user: safeUser(user),
    steps: record ? toDto(record) : null
  };
}

async function getRange(req, query, db = prisma) {
  const user = await resolveAuthenticatedUser(req, db);
  const today = new Date();
  const from = dateFromKey(normalizeDateKey(query.from || daysAgo(29, today)));
  const to = dateFromKey(normalizeDateKey(query.to || today));
  const records = await db.dailySteps.findMany({
    where: {
      userId: user.id,
      date: {
        gte: from,
        lte: to
      }
    },
    orderBy: { date: "asc" }
  });

  return {
    user: safeUser(user),
    from: dateKey(from),
    to: dateKey(to),
    steps: records.map(toDto)
  };
}

async function getStats(req, query, db = prisma) {
  const user = await resolveAuthenticatedUser(req, db);
  const days = query.period === "30d" ? 30 : 7;
  const today = new Date();
  const from = dateFromKey(normalizeDateKey(daysAgo(days - 1, today)));
  const to = dateFromKey(normalizeDateKey(today));
  const records = await db.dailySteps.findMany({
    where: {
      userId: user.id,
      date: {
        gte: from,
        lte: to
      }
    },
    orderBy: { date: "asc" }
  });

  return {
    user: safeUser(user),
    period: query.period,
    stats: buildStepStats(records, { today })
  };
}

function normalizeStepItem(item, date) {
  return {
    date,
    steps: integer(item.steps || item.passos),
    goal: integer(item.goal || item.meta || item.metaDiaria, 10000),
    source: normalizeSource(item.source || item.origem),
    updatedAt: parseDate(item.updatedAt, new Date())
  };
}

function reconcileStepRecord(existing, incoming) {
  if (!existing) {
    return {
      steps: Math.max(0, incoming.steps),
      goal: Math.max(1, incoming.goal),
      source: normalizeSource(incoming.source)
    };
  }

  const incomingTrusted =
    sourceRank(incoming.source) >= sourceRank(existing.source);
  const shouldReplace =
    incoming.steps > existing.steps ||
    (incoming.steps === existing.steps && incomingTrusted);

  if (!shouldReplace) {
    return {
      steps: existing.steps,
      goal: incoming.goal > 0 ? incoming.goal : existing.goal,
      source: existing.source
    };
  }

  return {
    steps: Math.max(0, incoming.steps),
    goal: incoming.goal > 0 ? incoming.goal : existing.goal,
    source: normalizeSource(incoming.source)
  };
}

function buildStepStats(records, options = {}) {
  const today = options.today || new Date();
  const normalized = records.map((record) => ({
    ...record,
    date: parseDate(record.date, null)
  })).filter((record) => record.date);
  const total = normalized.reduce((sum, record) => sum + integer(record.steps), 0);
  const best = normalized.reduce((current, record) => {
    if (!current || record.steps > current.steps) return record;
    return current;
  }, null);
  const completedGoals = normalized.filter((record) => record.steps >= record.goal).length;

  return {
    totalSteps: total,
    averageSteps: normalized.length > 0 ? Math.round(total / normalized.length) : 0,
    bestDay: best ? toDto(best) : null,
    goalCompletedDays: completedGoals,
    activeStreak: activeStepStreak(normalized, today)
  };
}

function activeStepStreak(records, today) {
  const byDate = new Map(records.map((record) => [dateKey(record.date), record]));
  let current = dateFromKey(normalizeDateKey(today));
  let streak = 0;

  while (true) {
    const record = byDate.get(dateKey(current));
    if (!record || record.steps < record.goal) break;
    streak += 1;
    current = new Date(current.getTime() - 86400000);
  }

  return streak;
}

async function resolveAuthenticatedUser(req, db = prisma) {
  const userId = text(req?.auth?.userId);
  if (!userId) {
    throw new AppError("Autenticacao obrigatoria.", 401, "authentication_required");
  }

  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new AppError("Usuario autenticado nao encontrado.", 401, "authenticated_user_not_found");
  }

  return user;
}

function toDto(record) {
  return {
    id: record.id,
    userId: record.userId,
    date: dateKey(record.date),
    steps: record.steps,
    goal: record.goal,
    source: record.source,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

function safeUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
}

function normalizeDateKey(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return dateKey(value);
  }

  const textValue = text(value);
  if (!textValue) return "";
  const match = textValue.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;

  const parsed = Date.parse(textValue);
  if (Number.isNaN(parsed)) return "";

  return dateKey(new Date(parsed));
}

function dateFromKey(key) {
  return new Date(`${key}T00:00:00.000Z`);
}

function dateKey(value) {
  if (!value) return "";
  return value.toISOString().slice(0, 10);
}

function daysAgo(days, from = new Date()) {
  return new Date(from.getTime() - days * 86400000);
}

function parseDate(value, fallback) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const parsed = Date.parse(String(value || ""));
  return Number.isNaN(parsed) ? fallback : new Date(parsed);
}

function sourceRank(source) {
  return {
    health_connect: 3,
    manual: 2,
    local: 1
  }[normalizeSource(source)] || 1;
}

function normalizeSource(source) {
  const value = text(source).toLowerCase();
  if (value === "health_connect" || value === "healthconnect" || value === "health") {
    return "health_connect";
  }
  if (value === "manual") return "manual";
  return "local";
}

function integer(value, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.round(value));
  }

  const parsed = Number(String(value || "").replace(",", ".").replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : fallback;
}

function text(value, fallback = "") {
  const result = value === undefined || value === null ? "" : String(value).trim();
  return result || fallback;
}

function logSteps(message) {
  if (process.env.NODE_ENV !== "production") {
    console.info(`[steps] ${message}`);
  }
}

module.exports = {
  syncSteps,
  getToday,
  getRange,
  getStats,
  reconcileStepRecord,
  buildStepStats,
  normalizeDateKey
};
