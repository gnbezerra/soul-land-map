// Tests for js/model.js. Run: node --test tests/
// Uses small made-up data, so editing the real CSVs never breaks them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModel, applyProgress, formatCount, nextTrialProgress } from "../js/model.js";

const categories = {
  groups: [
    { id: "normal_chest", types: ["chest_normal"], countsForExploration: true },
    { id: "divine_trial", types: ["divine_trial"], countsForExploration: true },
    { id: "extras", types: ["book"], countsForExploration: false },
    { id: "empty", types: ["boss"], countsForExploration: true },
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
  assert.deepEqual(model.exploration, { found: 0, total: 18 }, "only groups that count for exploration");
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
  assert.deepEqual(model.exploration, { found: 2, total: 18 });
});

test("trials count their done stages, capped at the stage count", () => {
  const model = build();
  applyProgress(model, new Set(), { "m-0004": 4, "m-0005": 99, "gone-0001": 5 });
  assert.equal(model.types.get("divine_trial").found, 4 + 3);
  assert.equal(model.groups.find((g) => g.id === "divine_trial").found, 7);
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
  assert.deepEqual(model.exploration, { found: 0, total: 18 });
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

test("formatCount", () => {
  assert.equal(formatCount(3, 10), "3/10");
});
