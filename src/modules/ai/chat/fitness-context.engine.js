const prisma = require("../../../config/prisma");
const { balanceForTotalXp } = require("../../progression/progression.sync.rules");
const { projection } = require("../gateway/catalog");
const { projectSplits, windowRecords } = require("./running-context");
const { withDeadline } = require("../gateway/gateway");
const AppError = require("../../../shared/errors/app-error");

const VERSION = "FitnessContext/v1";
const BUDGET = Object.freeze({ workouts: 5, setsPerWorkout: 48, runs: 20, stepsDays: 7,
  progressionEvents: 5, plans: 2, goals: 3, bytes: 14000, deadlineMs: 5000 });
const ids = new Set(projection.canonicalIds);
const names = new Map();
for (const [name, id] of Object.entries(projection.nameBindings)) if (!names.has(id)) names.set(id, name);
const unavailable = (source, reason = "remote_data_unavailable") => ({ status: "UNAVAILABLE", source, reason });
const domain = (source, data, isEmpty = false) => ({ status: isEmpty ? "EMPTY" : "AVAILABLE", source, data });
const text = (value) => String(value || "").replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[redacted]").slice(0, 100);
const iso = (value) => new Date(value).toISOString();

function createFitnessContextEngine({ client = prisma, now = () => new Date() } = {}) {
  async function query(source, action, project) {
    try { return await withDeadline(async () => project(await action()), BUDGET.deadlineMs); }
    catch { return unavailable(source); }
  }
  async function build({ userId, task }) {
    if (!userId) throw new AppError("Autenticacao necessaria.", 401, "unauthorized");
    const generatedAt = now();
    const selection = task === "running_advice" ? ["profile", "goals", "progression", "running"] :
      ["profile", "goals", "progression", "strength", "running", "steps", "currentPlan"];
    const jobs = {
      profile: () => query("authenticated_profile", () => client.profile.findUnique({ where: { userId }, select: { goal: true, level: true } }),
        (p) => domain("authenticated_profile", p ? { fitnessGoal: text(p.goal), trainingExperience: text(p.level) } : null, !p)),
      goals: () => query("user_goals", () => client.goal.findMany({ where: { userId }, orderBy: [{ updatedAt: "desc" }, { id: "asc" }], take: BUDGET.goals,
        select: { category: true, currentValue: true, targetValue: true, status: true } }),
        (items) => domain("user_goals", items.map((g) => ({ category: text(g.category), currentValue: g.currentValue, targetValue: g.targetValue, status: text(g.status) })), !items.length)),
      progression: async () => {
        const source = "ProgressionSyncContract/v1";
        return query(source, async () => {
          const [total, events] = await Promise.all([
            client.progressionXpEvent.aggregate({ where: { userId }, _sum: { xpAwarded: true }, _count: true }),
            client.progressionXpEvent.findMany({ where: { userId }, orderBy: [{ occurredAt: "desc" }, { id: "asc" }], take: BUDGET.progressionEvents,
              select: { sourceType: true, xpAwarded: true, occurredAt: true } })
          ]); return { total, events };
        }, ({ total, events }) => domain(source, { ...balanceForTotalXp(total._sum.xpAwarded || 0),
          events: events.map((e) => ({ type: e.sourceType, xp: e.xpAwarded, date: iso(e.occurredAt) })) }, total._count === 0));
      },
      strength: () => query("workout_sync_sessions", () => client.workoutSyncSession.findMany({
        where: { userId, status: "completed", finishedAt: { not: null } },
        orderBy: [{ finishedAt: "desc" }, { id: "asc" }], take: BUDGET.workouts,
        select: { startedAt: true, finishedAt: true, sets: { where: { userId }, take: BUDGET.setsPerWorkout,
          orderBy: [{ completedAt: "asc" }, { setIndex: "asc" }, { id: "asc" }],
          select: { exerciseId: true, weight: true, reps: true, setIndex: true } }, _count: { select: { sets: true } } }
      }), (sessions) => {
        const window = sessions.map((s) => {
          const sets = s.sets.filter((x) => ids.has(x.exerciseId) && Number.isFinite(x.weight) && x.weight >= 0 && x.reps > 0);
          const complete = s._count.sets === sets.length;
          return { date: iso(s.finishedAt), durationSeconds: Math.max(0, Math.round((s.finishedAt - s.startedAt) / 1000)),
            coverage: complete ? "COMPLETE" : "PARTIAL", volumeKgReps: complete ? sets.reduce((sum, x) => sum + x.weight * x.reps, 0) : null,
            performance: sets.slice(0, task === "chat" ? 4 : 12).map((x) => ({ exerciseId: x.exerciseId, name: names.get(x.exerciseId), weightKg: x.weight, reps: x.reps, set: x.setIndex })) };
        });
        return domain("workout_sync_sessions", { recentFinalized: window,
          lifetimePRs: unavailable("local_strength_metrics", "canonical_lifetime_pr_projection_not_synced"),
          progression: unavailable("local_strength_metrics", "configured_increment_and_recommendation_not_synced") }, !sessions.length);
      }),
      running: () => query("ActivitySyncContract/v2.running", () => client.runningHistory.findMany({
        where: { userId, deletedAt: null }, orderBy: [{ finishedAt: "desc" }, { id: "asc" }], take: BUDGET.runs,
        select: { distanceKm: true, durationSeconds: true, averageSpeed: true, finishedAt: true, route: true }
      }), (all) => {
        const runs = all.filter((r) => Number.isFinite(r.distanceKm) && r.distanceKm >= 0 && r.durationSeconds > 0);
        const recent = runs.slice(0, task === "chat" ? 2 : 5).map((r) => ({ date: iso(r.finishedAt), distanceKm: r.distanceKm,
          durationSeconds: r.durationSeconds, averageSpeedKmh: r.averageSpeed,
          paceSecondsPerKm: r.distanceKm > 0 ? r.durationSeconds / r.distanceKm : null,
          splits: (projectSplits(r) || []).slice(0, 10) }));
        const aggregate = (days) => {
          const inPeriod = runs.filter((r) => generatedAt - r.finishedAt < days * 86400000 && generatedAt >= r.finishedAt);
          const distanceKm = inPeriod.reduce((s, r) => s + r.distanceKm, 0), durationSeconds = inPeriod.reduce((s, r) => s + r.durationSeconds, 0);
          return { count: inPeriod.length, distanceKm, durationSeconds, paceSecondsPerKm: distanceKm > 0 && inPeriod.every((r) => r.distanceKm > 0) ? durationSeconds / distanceKm : null };
        };
        return domain("ActivitySyncContract/v2.running", { scope: "latest_20_synced_runs_not_lifetime", recent,
          windowBests: windowRecords(runs), rolling7Days: aggregate(7), rolling30Days: aggregate(30),
          lifetimePRs: unavailable("local_running_metrics", "bounded_remote_window_not_lifetime") }, !runs.length);
      }),
      steps: () => query("ActivitySyncContract/v2.steps", () => client.dailySteps.findMany({ where: { userId },
        orderBy: [{ dayKey: "desc" }, { id: "asc" }], take: BUDGET.stepsDays,
        select: { dayKey: true, steps: true, goal: true } }), (days) => domain("ActivitySyncContract/v2.steps", {
          today: unavailable("canonical_dayKey", "device_timezone_not_available_do_not_guess_utc_day"),
          recentDays: days.map((d) => ({ dayKey: d.dayKey, steps: d.steps, goal: d.goal, goalCompleted: d.goal > 0 && d.steps >= d.goal }))
        }, !days.length)),
      currentPlan: () => query("workouts", () => client.workout.findMany({ where: { userId, deletedAt: null },
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }], take: BUDGET.plans,
        select: { goal: true, split: true, daysPerWeek: true, estimatedMinutes: true } }), (plans) => domain("workouts", {
          active: unavailable("local_plan_selection", "active_selection_not_synced"),
          recent: plans.map((p) => ({ goal: text(p.goal), split: text(p.split), daysPerWeek: p.daysPerWeek, estimatedMinutes: p.estimatedMinutes }))
        }, !plans.length))
    };
    const values = await Promise.all(selection.map(async (key) => [key, await jobs[key]()]));
    const context = { contractVersion: VERSION, generatedAt: generatedAt.toISOString(), freshness: "synced_server_only",
      task, domains: Object.fromEntries(values) };
    if (Buffer.byteLength(JSON.stringify(context)) > BUDGET.bytes) {
      // Deterministic fail-closed domain budgeting; never trim by cutting JSON.
      for (const key of [...selection].reverse()) {
        context.domains[key] = unavailable(context.domains[key].source, "context_budget_exceeded");
        if (Buffer.byteLength(JSON.stringify(context)) <= BUDGET.bytes) break;
      }
    }
    return context;
  }
  return { build };
}
module.exports = { createFitnessContextEngine, VERSION, BUDGET };
