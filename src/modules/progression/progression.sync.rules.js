const CONTRACT_VERSION = "ProgressionSyncContract/v1";
const RULES_VERSION = 1;

const XP_BY_SOURCE = Object.freeze({
  workout: 15,
  running: 10,
  stepsGoal: 8
});

const supportedSourceTypes = new Set(Object.keys(XP_BY_SOURCE));

function xpForSource(sourceType, rulesVersion = RULES_VERSION) {
  if (rulesVersion !== RULES_VERSION) return null;
  return XP_BY_SOURCE[sourceType] || null;
}

function balanceForTotalXp(totalXp) {
  const safeTotal = Math.max(0, Number(totalXp) || 0);
  let remaining = safeTotal;
  let currentLevel = 1;

  while (remaining >= xpForNextLevel(currentLevel)) {
    remaining -= xpForNextLevel(currentLevel);
    currentLevel += 1;
  }

  return {
    totalXp: safeTotal,
    currentLevel,
    xpIntoCurrentLevel: remaining,
    xpForNextLevel: xpForNextLevel(currentLevel)
  };
}

function xpForNextLevel(level) {
  if (level <= 10) return 100;
  if (level <= 25) return 150;
  if (level <= 50) return 250;
  return 400;
}

module.exports = {
  CONTRACT_VERSION,
  RULES_VERSION,
  XP_BY_SOURCE,
  supportedSourceTypes,
  xpForSource,
  balanceForTotalXp
};
