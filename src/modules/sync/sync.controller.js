const AppError = require("../../shared/errors/app-error");
const { parseSyncPayload, getPayloadItems } = require("./sync.schemas");
const syncService = require("./sync.service");

async function postProfileController(req, res) {
  const payload = parsePayload(req.body);
  const result = await syncService.syncProfile(req, payload);

  return res.status(200).json(result);
}

async function getProfileController(req, res) {
  const result = await syncService.getProfile(req, queryPayload(req));

  return res.status(200).json(result);
}

async function postGoalsController(req, res) {
  const payload = parsePayload(req.body);
  const result = await syncService.syncGoals(req, payload, getPayloadItems(payload));

  return res.status(200).json(result);
}

async function getGoalsController(req, res) {
  const result = await syncService.getGoals(req, queryPayload(req));

  return res.status(200).json(result);
}

async function postRecordsController(req, res) {
  const payload = parsePayload(req.body);
  const result = await syncService.syncRecords(req, payload, getPayloadItems(payload));

  return res.status(200).json(result);
}

async function getRecordsController(req, res) {
  const result = await syncService.getRecords(req, queryPayload(req));

  return res.status(200).json(result);
}

async function postWorkoutsController(req, res) {
  const payload = parsePayload(req.body);
  const result = await syncService.syncWorkouts(req, payload, getPayloadItems(payload));

  return res.status(200).json(result);
}

async function getWorkoutsController(req, res) {
  const result = await syncService.getWorkouts(req, queryPayload(req));

  return res.status(200).json(result);
}

async function postWorkoutHistoryController(req, res) {
  const payload = parsePayload(req.body);
  const result = await syncService.syncWorkoutHistory(req, payload, getPayloadItems(payload));

  return res.status(200).json(result);
}

async function postRunningController(req, res) {
  const payload = parsePayload(req.body);
  const result = await syncService.syncRunning(req, payload, getPayloadItems(payload));

  return res.status(200).json(result);
}

function parsePayload(body) {
  const validation = parseSyncPayload(body);

  if (!validation.valid) {
    throw new AppError("Payload de sincronizacao invalido.", 400, "invalid_sync_payload", validation.errors);
  }

  return validation.data;
}

function queryPayload(req) {
  return {
    clientId: req.query.clientId || req.headers["x-fitia-client-id"]
  };
}

module.exports = {
  postProfileController,
  getProfileController,
  postGoalsController,
  getGoalsController,
  postRecordsController,
  getRecordsController,
  postWorkoutsController,
  getWorkoutsController,
  postWorkoutHistoryController,
  postRunningController
};
