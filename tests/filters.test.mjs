// Tests for js/filters.js. Run: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { isSolo, toggleSolo, endSolo, cleanSolo } from "../js/filters.js";

const ALL = ["chest", "coop", "crystal", "trial"];

test("only this: shows just those types and remembers the filter it replaced", () => {
  const state = toggleSolo({ hidden: new Set(["trial"]), solo: null }, ["crystal"], ALL);
  assert.deepEqual([...state.hidden].sort(), ["chest", "coop", "trial"]);
  assert.deepEqual(state.solo, { types: ["crystal"], previous: ["trial"] });
  assert.equal(isSolo(state.solo, ["crystal"]), true);
  assert.equal(isSolo(state.solo, ["chest"]), false);
  assert.equal(isSolo(null, ["crystal"]), false);
});

test("only this, a second time on the same category: gives the filter back", () => {
  const on = toggleSolo({ hidden: new Set(["trial"]), solo: null }, ["chest", "coop"], ALL);
  assert.equal(isSolo(on.solo, ["coop", "chest"]), true, "a group, in any order");
  const off = toggleSolo(on, ["coop", "chest"], ALL);
  assert.deepEqual([...off.hidden], ["trial"]);
  assert.equal(off.solo, null);
});

test("only this on another category keeps the filter from before the first one", () => {
  const first = toggleSolo({ hidden: new Set(["trial"]), solo: null }, ["crystal"], ALL);
  const second = toggleSolo(first, ["chest"], ALL);
  assert.deepEqual([...second.hidden].sort(), ["coop", "crystal", "trial"]);
  assert.deepEqual(second.solo.previous, ["trial"]);
  assert.deepEqual([...endSolo(second.solo).hidden], ["trial"]);
});

test("endSolo with nothing saved shows everything", () => {
  assert.deepEqual(endSolo(null), { hidden: new Set(), solo: null });
});

test("cleanSolo keeps a well formed solo with known types only", () => {
  assert.deepEqual(cleanSolo({ types: ["crystal", "gone"], previous: ["trial", 3, "gone"] }, ALL),
    { types: ["crystal"], previous: ["trial"] });
  assert.equal(cleanSolo({ types: ["gone"], previous: [] }, ALL), null, "no known type left");
  for (const bad of [null, undefined, "x", [], { types: "crystal", previous: [] }, { types: ["crystal"] }]) {
    assert.equal(cleanSolo(bad, ALL), null, JSON.stringify(bad));
  }
});
