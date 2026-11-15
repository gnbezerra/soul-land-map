// Tests for js/exploration.js. Run: node --test tests/
// Uses small made-up models and milestones, so editing the real data never breaks them. The real rules
// are checked once against the game's own total for Nuoding (3080), below.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { explorationValue, milestoneStatus, milestoneMarks } from "../js/exploration.js";

// The part of a js/model.js model that explorationValue reads: type id -> { found, total }.
const modelOf = (counts) => ({ types: new Map(Object.entries(counts).map(([id, [found, total]]) => [id, { found, total }])) });
const rules = [
  { id: "chests", types: ["chest_normal", "chest_coop"], points: 5 },
  { id: "trials", types: ["divine_trial"], points: 10 },
  { id: "encounters", types: ["encounter"], points: 80 },
];

test("points are counts times the rule's points, and a rule sums its types", () => {
  const value = explorationValue(modelOf({ chest_normal: [3, 10], chest_coop: [1, 2], divine_trial: [4, 13] }), rules);
  assert.equal(value.found, (3 + 1) * 5 + 4 * 10);
  assert.equal(value.total, (10 + 2) * 5 + 13 * 10);
  assert.deepEqual(value.rules, [
    { id: "chests", points: 5, found: 4, total: 12 },
    { id: "trials", points: 10, found: 4, total: 13 },
  ]);
});

test("rules and types with no data add nothing and are left out", () => {
  const value = explorationValue(modelOf({ chest_normal: [0, 10], book: [5, 5] }), rules);
  assert.deepEqual(value, { found: 0, total: 50, rules: [{ id: "chests", points: 5, found: 0, total: 10 }] });
  assert.deepEqual(explorationValue(modelOf({}), rules), { found: 0, total: 0, rules: [] });
  assert.deepEqual(explorationValue(modelOf({ chest_normal: [1, 1] })), { found: 0, total: 0, rules: [] }, "no rules");
});

test("the real rules give the game's total for a map like Nuoding (3080)", () => {
  // Nuoding's game counters (SPEC 11): 264 normal and 16 decryption chests, 65 trial layers, 28 crystals,
  // 5 encounters, 6 teleports and 4 viewpoints. Seeds are in no rule (their points are unconfirmed).
  const { explorationRules } = JSON.parse(readFileSync(new URL("../data/categories.json", import.meta.url), "utf8"));
  const value = explorationValue(modelOf({
    chest_normal: [0, 264], chest_coop: [0, 4], chest_challenge: [0, 6], chest_contract: [0, 6],
    divine_trial: [0, 65], crystal: [0, 28], encounter: [0, 5], teleport: [0, 6], viewpoint: [0, 4], seed: [0, 8],
  }), explorationRules);
  assert.equal(value.total, 3080);
});

const milestones = [250, 500, 1000, 1500, 2000, 2500];

test("milestoneStatus: the next milestone and the points left to it", () => {
  assert.deepEqual(milestoneStatus(0, milestones), { reached: 0, next: 250, left: 250, none: false });
  assert.deepEqual(milestoneStatus(1385, milestones), { reached: 3, next: 1500, left: 115, none: false });
  assert.deepEqual(milestoneStatus(1500, milestones), { reached: 4, next: 2000, left: 500, none: false }, "a milestone hit exactly");
  assert.deepEqual(milestoneStatus(2500, milestones), { reached: 6, next: null, left: 0, none: false }, "all reached");
  assert.deepEqual(milestoneStatus(3080, milestones), { reached: 6, next: null, left: 0, none: false });
});

test("milestoneStatus: unsorted milestones, and a map without milestones", () => {
  assert.deepEqual(milestoneStatus(600, [1000, 250, 500]), { reached: 2, next: 1000, left: 400, none: false });
  assert.deepEqual(milestoneStatus(600, []), { reached: 0, next: null, left: 0, none: true });
  assert.deepEqual(milestoneStatus(600), { reached: 0, next: null, left: 0, none: true });
});

test("milestoneMarks: a position on the bar for each milestone within the total", () => {
  assert.deepEqual(milestoneMarks([500, 250, 1000], 600, 1000), [
    { milestone: 250, percent: 25, reached: true },
    { milestone: 500, percent: 50, reached: true },
    { milestone: 1000, percent: 100, reached: false },
  ]);
  // A map still being mapped: milestones above the current total have no place on the bar yet.
  assert.deepEqual(milestoneMarks(milestones, 0, 800).map((m) => m.milestone), [250, 500]);
  assert.deepEqual(milestoneMarks(milestones, 0, 0), [], "nothing mapped");
  assert.deepEqual(milestoneMarks(undefined, 0, 100), []);
});
