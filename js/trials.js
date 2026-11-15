// Divine Trial progress rules. Pure: no DOM and no Leaflet, so it is easy to test.
//
// A trial has a list of stages ("layers" on the site, SPEC 4.6) played in order, so its progress is
// one number: the stages done. Progress is kept per map as { trialId: stagesDone } (positive integers;
// 0 is stored as no entry). A trial with every stage done counts as found.

// Number of stages of a marker; 0 for anything that is not a Divine Trial with stages.
export function stageCount(marker) {
  return marker.stages?.length ?? 0;
}

// { trialId: stage count } for the trials among `markers`.
export function stageCounts(markers) {
  return new Map(markers.filter((m) => stageCount(m)).map((m) => [m.id, stageCount(m)]));
}

// Stages done as counted and shown: saved progress never counts more than the stages the trial has
// (the data may lose a stage after the progress was saved).
export function stagesDone(saved, total) {
  return Math.min(saved ?? 0, total);
}

export function isTrialComplete(done, total) {
  return total > 0 && done >= total;
}

// The "4/10" badge shows only while a trial is started but not complete.
export function isTrialStarted(done, total) {
  return done > 0 && done < total;
}

// Clicking a layer that is not done marks it and the ones before it; clicking a done layer unmarks it
// and the ones after.
//   nextTrialProgress(8, 5) -> 4      nextTrialProgress(4, 7) -> 7
export function nextTrialProgress(done, clicked) {
  return clicked <= done ? clicked - 1 : clicked;
}

// The popup button marks every layer done, or resets a complete trial.
export function markAllProgress(done, total) {
  return done >= total ? 0 : total;
}

// Stores the stages done of one trial in `trials` (0 removes it).
export function setTrialProgress(trials, id, done) {
  if (done > 0) trials[id] = done;
  else delete trials[id];
}

// Progress migration. Before stage progress existed, a trial could only be marked found as a whole, so
// a trial id in the set of found ids means all its stages are done: moves those ids from `foundIds`
// into `trials` as complete, never lowering progress already there. Runs when a map loads and when a
// backup is imported. `counts` is stageCounts(markers). Returns whether anything changed.
export function migrateFoundTrials(foundIds, trials, counts) {
  let changed = false;
  for (const [id, total] of counts) {
    if (!foundIds.has(id)) continue;
    foundIds.delete(id);
    trials[id] = Math.max(trials[id] ?? 0, total);
    changed = true;
  }
  return changed;
}
