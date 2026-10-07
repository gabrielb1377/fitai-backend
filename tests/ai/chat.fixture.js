const { randomUUID } = require("node:crypto");
const { claimWithinTransaction, currentPeriodStart, hashPayload } = require("../../src/modules/ai/ai-usage.service");

function memoryClient() {
  const usages = [], conversations = [], messages = [];
  let serial = Promise.resolve();
  const matches = (row, where = {}) => Object.entries(where).every(([key, value]) => {
    if (key === "OR") return value.some((v) => matches(row, v));
    if (value && typeof value === "object" && !(value instanceof Date)) {
      if (value.in) return value.in.includes(row[key]);
      if (value.lt) return row[key] && row[key] < value.lt;
      if (key.includes("_")) return matches(row, value);
    }
    return row[key] instanceof Date ? +row[key] === +value : row[key] === value;
  });
  function update(row, data) {
    for (const [k, v] of Object.entries(data)) row[k] = v?.increment ? row[k] + v.increment : v;
    row.updatedAt = new Date(); return row;
  }
  const model = (rows) => ({
    findUnique: async ({ where }) => structuredClone(rows.find((r) => matches(r, where)) || null),
    findFirst: async ({ where }) => structuredClone(rows.find((r) => matches(r, where)) || null),
    count: async ({ where }) => rows.filter((r) => matches(r, where)).length,
    create: async ({ data }) => { const r = { id: randomUUID(), status: "pending", updatedAt: new Date(), ...data }; rows.push(r); return structuredClone(r); },
    update: async ({ where, data }) => update(rows.find((r) => matches(r, where)), data),
    updateMany: async ({ where, data }) => { const found = rows.filter((r) => matches(r, where)); found.forEach((r) => update(r, data)); return { count: found.length }; }
  });
  const client = { aiUsage: model(usages), aiConversation: model(conversations), aiChatMessage: model(messages) };
  client.aiConversation.upsert = async ({ where, create }) => structuredClone(conversations.find((r) => matches(r, where))) ||
    client.aiConversation.create({ data: { nextSequence: 0, lockVersion: 0, pendingUsageId: null, pendingUntil: null, ...create } });
  client.aiChatMessage.createMany = async ({ data }) => { messages.push(...data); return { count: data.length }; };
  client.aiChatMessage.findMany = async ({ where, take }) => messages.filter((r) => matches(r, where)).sort((a, b) => b.sequence - a.sequence).slice(0, take);
  client.$transaction = (fn) => { const next = serial.then(() => fn(client)); serial = next.catch(() => {}); return next; };
  const claim = (args) => client.$transaction((tx) => claimWithinTransaction({ ...args, tx,
    requestHash: hashPayload(args.input), periodStart: currentPeriodStart() }));
  const fail = (id, error) => client.aiUsage.updateMany({ where: { id, status: "pending" }, data: { status: "failed", errorCode: error.code } });
  return { client, claim, fail, usages, conversations, messages };
}
module.exports = { memoryClient };
