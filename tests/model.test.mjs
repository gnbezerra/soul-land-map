// Tests for js/model.js. Run: node --test tests/
// Uses small made-up data, so editing the real CSVs never breaks them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModel, applyProgress, formatCount, countProgress } from "../js/model.js";

const categories = {
  groups: [
    { id: "normal_chest", types: ["chest_normal"] },
    { id: "divine_trial", types: ["divine_trial"] },
    { id: "extras", types: ["book"] },
    { id: "empty", types: ["boss"] },
  ],
  // Books give no points; bosses would, but there is no data for them.
  explorationRules: [
    { id: "chests", types: ["chest_normal"], points: 5 },
    { id: "trials", types: ["divine_trial"], points: 10 },
    { id: "bosses", types: ["boss"], points: 80 },
  ],
  types: {
    chest_normal: { color: "#000", glyph: "C" },
    divine_trial: { color: "#000", glyph: "D" },
    book: { color: "#000", glyph: "B" },
    boss: { color: "#000", glyph: "X" },
  },
};
const entries = {
  "set-a": { type: "chest_normal", size: 3 },
  "set-b": { type: "chest_normal", size: 2 },
};
const stages = (n) => Array.from({ length: n }, () => ({ stars: 1 }));
const markers = [
  { id: "m-0001", type: "chest_normal", entry: "set-a" },
  { id: "m-0002", type: "chest_normal", entry: "set-a" },
  { id: "m-0003", type: "chest_normal", entry: "set-b" },
  { id: "m-0004", type: "divine_trial", stages: stages(10) },
  { id: "m-0005", type: "divine_trial", stages: stages(3) },
  { id: "m-0006", type: "book" },
  { id: "m-0007", type: "unknown_type" },
];
const build = () => buildModel(categories, entries, markers);

test("totals: entry sizes, stages per trial, mapped count otherwise", () => {
  const model = build();
  assert.equal(model.types.get("chest_normal").total, 5, "sum of entry sizes, not the 3 mapped markers");
  assert.equal(model.types.get("divine_trial").total, 13, "a trial counts once per stage");
  assert.equal(model.types.get("book").total, 1);
  // Exploration value in points: 5 chests x 5 + 13 layers x 10; books and the bosses without data add nothing.
  assert.deepEqual([model.exploration.found, model.exploration.total], [0, 155]);
  assert.deepEqual(model.exploration.rules.map((r) => r.id), ["chests", "trials"]);
});

test("groups without data are hidden; unknown types are reported", () => {
  const model = build();
  assert.deepEqual(model.groups.map((g) => g.id), ["normal_chest", "divine_trial", "extras"]);
  assert.deepEqual(model.unknownTypes, ["unknown_type"]);
});

test("found markers count per type, entry and group; stale ids are ignored", () => {
  const model = build();
  applyProgress(model, new Set(["m-0001", "m-0003", "m-0006", "gone-0001"]), {});
  assert.equal(model.types.get("chest_normal").found, 2);
  assert.equal(model.entryById.get("set-a").found, 1);
  assert.equal(model.entryById.get("set-b").found, 1);
  assert.equal(model.types.get("book").found, 1);
  assert.deepEqual([model.exploration.found, model.exploration.total], [10, 155], "two chests; the book gives no points");
});

test("trials count their done stages, capped at the stage count", () => {
  const model = build();
  applyProgress(model, new Set(), { "m-0004": 4, "m-0005": 99, "gone-0001": 5 });
  assert.equal(model.types.get("divine_trial").found, 4 + 3);
  assert.equal(model.groups.find((g) => g.id === "divine_trial").found, 7);
  assert.equal(model.exploration.found, 70, "10 points per layer");
});

test("a trial id in the found set does not count (stage progress is the only source)", () => {
  const model = build();
  applyProgress(model, new Set(["m-0004"]), {});
  assert.equal(model.types.get("divine_trial").found, 0);
});

test("applyProgress recomputes from scratch", () => {
  const model = build();
  applyProgress(model, new Set(["m-0001"]), { "m-0004": 2 });
  applyProgress(model, new Set(), {});
  assert.deepEqual([model.exploration.found, model.exploration.total], [0, 155]);
});

test("no exploration rules: the exploration value is empty", () => {
  const model = buildModel({ ...categories, explorationRules: undefined }, entries, markers);
  assert.deepEqual(model.exploration, { found: 0, total: 0, rules: [] });
});

test("countProgress: found markers without trials, and trial layers, ignoring stale ids", () => {
  const found = new Set(["m-0001", "m-0003", "m-0006", "gone-0001"]);
  assert.deepEqual(countProgress(markers, found, { "m-0004": 4, "m-0005": 99, "gone-0002": 5 }), { markers: 3, layers: 4 + 3 });
  assert.deepEqual(countProgress(markers, new Set(["m-0004"]), {}), { markers: 0, layers: 0 },
    "a trial id in the found set is not a marker");
  assert.deepEqual(countProgress(markers, new Set(), {}), { markers: 0, layers: 0 });
});

test("formatCount", () => {
  assert.equal(formatCount(3, 10), "3/10");
});
