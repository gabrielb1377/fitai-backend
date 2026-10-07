// Read projection of FITAI-12 accepted progress. Coordinates never leave this boundary.
function projectSplits(run) {
  const route = Array.isArray(run.route) ? run.route : [];
  if (route.length < 2 || route.length > 10000 || !(run.distanceKm > 0) || !(run.durationSeconds > 0)) return null;
  let distance = 0, seconds = 0, timestamp = -Infinity;
  for (const point of route) {
    const d = point.cumulativeDistanceKm, s = point.activeElapsedSeconds;
    const t = Date.parse(point.timestamp);
    if (!Number.isFinite(d) || !Number.isInteger(s) || s < 0 || d < distance ||
        d > run.distanceKm + 1e-9 || s < seconds || s > run.durationSeconds ||
        !Number.isFinite(t) || t <= timestamp || d - distance > (s - seconds + 1) / 100 ||
        (point.startsSegment === true && d !== distance)) return null;
    distance = d; seconds = s; timestamp = t;
  }
  if (route[0].cumulativeDistanceKm !== 0 || Math.abs(distance - run.distanceKm) > 1e-9) return null;
  const result = [];
  let boundary = 1, lastCrossing = 0;
  distance = 0; seconds = 0;
  for (const point of route) {
    const d = point.cumulativeDistanceKm, s = point.activeElapsedSeconds;
    while (d + 1e-9 >= boundary && d > distance) {
      const ratio = Math.min(1, Math.max(0, (boundary - distance) / (d - distance)));
      const crossing = Math.round(seconds + (s - seconds) * ratio);
      result.push({ kilometer: boundary++, elapsedSeconds: crossing - lastCrossing, distanceKm: 1, isPartial: false });
      lastCrossing = crossing;
    }
    distance = d; seconds = s;
  }
  const remainder = run.distanceKm - (boundary - 1);
  if (remainder > 1e-9) result.push({ kilometer: boundary, elapsedSeconds: run.durationSeconds - lastCrossing, distanceKm: remainder, isPartial: true });
  return result;
}

function windowRecords(runs) {
  const best = {};
  for (const run of runs) {
    best.longestDistanceKm = Math.max(best.longestDistanceKm || 0, run.distanceKm);
    if (run.distanceKm >= 1 && run.durationSeconds > 0) {
      best.bestAveragePaceSecondsPerKm = Math.min(best.bestAveragePaceSecondsPerKm || Infinity, run.durationSeconds / run.distanceKm);
    }
    const splits = projectSplits(run);
    if (!splits) continue;
    for (const km of [1, 5, 10]) {
      for (let i = 0; i <= splits.length - km; i++) {
        const group = splits.slice(i, i + km);
        if (group.some((s) => s.isPartial)) continue;
        const value = group.reduce((sum, s) => sum + s.elapsedSeconds, 0);
        best[`best${km}kSeconds`] = Math.min(best[`best${km}kSeconds`] || Infinity, value);
      }
    }
  }
  return best;
}
module.exports = { projectSplits, windowRecords };
