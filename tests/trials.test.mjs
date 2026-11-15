// Tests for js/trials.js. Run: node --test tests/
// Uses small made-up trials, so editing the real CSVs never breaks them.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  stageCount, stageCounts, stagesDone, isTrialComplete, isTrialStarted, nextTrialProgress, markAllProgress,
  setTrialProgress, migrateFoundTrials,
} from "../js/trials.js";

const stages = (n) => Array.from({ length: n }, () => ({ stars: 1 }));
const markers = [
  { id: "m-0001", type: "chest_normal" },
  { id: "m-0002", type: "divine_trial", stages: stages(10) },
  { id: "m-0003", type: "divine_trial", stages: stages(3) },
  { id: "m-0004", type: "divine_trial" }, // stages not collected yet
  { id: "m-0005", type: "divine_trial", stages: [] },
];

test("stageCount and stageCounts list only trials with stages", () => {
  assert.deepEqual(markers.map(stageCount), [0, 10, 3, 0, 0]);
  assert.deepEqual([...stageCounts(markers)], [["m-0002", 10], ["m-0003", 3]]);
  assert.deepEqual([...stageCounts([])], []);
});

test("stagesDone never counts more stages than the trial has", () => {
  assert.equal(stagesDone(4, 10), 4);
  assert.equal(stagesDone(10, 10), 10);
  assert.equal(stagesDone(12, 10), 10, "a stage removed from the data after the progress was saved");
  assert.equal(stagesDone(undefined, 10), 0, "no saved progress");
});

test("a trial is complete with every stage done, and started in between", () => {
  assert.equal(isTrialComplete(10, 10), true);
  assert.equal(isTrialComplete(9, 10), false);
  assert.equal(isTrialComplete(0, 0), false, "a trial without stages is never complete");
  assert.equal(isTrialStarted(0, 10), false);
  assert.equal(isTrialStarted(1, 10), true);
  assert.equal(isTrialStarted(9, 10), true);
  assert.equal(isTrialStarted(10, 10), false, "complete: no badge");
});

test("nextTrialProgress: a layer not done marks up to it, a done layer unmarks from it", () => {
  assert.equal(nextTrialProgress(0, 1), 1);
  assert.equal(nextTrialProgress(4, 7), 7);
  assert.equal(nextTrialProgress(8, 9), 9);
  assert.equal(nextTrialProgress(8, 5), 4, "the clicked done layer and the later ones are unmarked");
  assert.equal(nextTrialProgress(8, 8), 7);
  assert.equal(nextTrialProgress(8, 1), 0);
  assert.equal(nextTrialProgress(10, 10), 9);
});

test("markAllProgress completes a trial, or resets a complete one", () => {
  assert.equal(markAllProgress(0, 10), 10);
  assert.equal(markAllProgress(7, 10), 10);
  assert.equal(markAllProgress(10, 10), 0);
});

test("setTrialProgress stores positive progress and removes zero", () => {
  const trials = { "m-0002": 4 };
  setTrialProgress(trials, "m-0003", 2);
  assert.deepEqual(trials, { "m-0002": 4, "m-0003": 2 });
  setTrialProgress(trials, "m-0002", 0);
  assert.deepEqual(trials, { "m-0003": 2 });
  setTrialProgress(trials, "m-0009", 0);
  assert.deepEqual(trials, { "m-0003": 2 }, "removing what is not there");
});

test("migration: trial ids in the found set become complete trials", () => {
  const found = new Set(["m-0001", "m-0002"]);
  const trials = {};
  assert.equal(migrateFoundTrials(found, trials, stageCounts(markers)), true);
  assert.deepEqual([...found], ["m-0001"], "other found ids stay");
  assert.deepEqual(trials, { "m-0002": 10 });
});

test("migration never lowers progress, and keeps progress of other trials", () => {
  const found = new Set(["m-0002", "m-0003"]);
  const trials = { "m-0002": 4, "m-0003": 7, "m-0009": 2 };
  assert.equal(migrateFoundTrials(found, trials, stageCounts(markers)), true);
  assert.deepEqual([...found], []);
  // m-0003 had more saved than its 3 stages: kept, and stagesDone caps what is shown.
  assert.deepEqual(trials, { "m-0002": 10, "m-0003": 7, "m-0009": 2 });
});

test("migration leaves current progress alone and reports no change", () => {
  const found = new Set(["m-0001", "m-0004", "m-9999"]);
  const trials = { "m-0002": 3 };
  assert.equal(migrateFoundTrials(found, trials, stageCounts(markers)), false);
  // m-0004 is a trial without stages yet: it is still marked found the old way.
  assert.deepEqual([...found], ["m-0001", "m-0004", "m-9999"]);
  assert.deepEqual(trials, { "m-0002": 3 });
});

test("migration is idempotent", () => {
  const found = new Set(["m-0002"]);
  const trials = {};
  migrateFoundTrials(found, trials, stageCounts(markers));
  assert.equal(migrateFoundTrials(found, trials, stageCounts(markers)), false);
  assert.deepEqual(trials, { "m-0002": 10 });
});
