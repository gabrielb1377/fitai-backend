const AppError = require("../../shared/errors/app-error");
const stepsService = require("./steps.service");
const {
  parseStepsPayload,
  parseRangeQuery,
  parseStatsQuery,
  getStepItems
} = require("./steps.schemas");

async function syncStepsController(req, res) {
  const payload = parsePayload(req.body);
  const items = getStepItems(payload);
  const result = await stepsService.syncSteps(req, payload, items);

  return res.status(200).json(result);
}

async function todayStepsController(req, res) {
  const payload = queryPayload(req);
  const result = await stepsService.getToday(req, payload);

  return res.status(200).json(result);
}

async function rangeStepsController(req, res) {
  const query = parseQuery(req.query, parseRangeQuery);
  const result = await stepsService.getRange(req, query);

  return res.status(200).json(result);
}

async function statsStepsController(req, res) {
  const query = parseQuery(req.query, parseStatsQuery);
  const result = await stepsService.getStats(req, query);

  return res.status(200).json(result);
}

function parsePayload(body) {
  const validation = parseStepsPayload(body);

  if (!validation.valid) {
    throw new AppError("Payload de passos invalido.", 400, "invalid_steps_payload", validation.errors);
  }

  return validation.data;
}

function parseQuery(query, parser) {
  const validation = parser(query);

  if (!validation.valid) {
    throw new AppError("Consulta de passos invalida.", 400, "invalid_steps_query", validation.errors);
  }

  return validation.data;
}

function queryPayload(req) {
  return {
    clientId: req.query.clientId || req.headers["x-fitai-client-id"]
  };
}

module.exports = {
  syncStepsController,
  todayStepsController,
  rangeStepsController,
  statsStepsController
};
