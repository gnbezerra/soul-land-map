// Tests for js/filters.js. Run: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { isSolo, toggleSolo, endSolo, cleanSolo, canSoloEntry } from "../js/filters.js";

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

test("only this on an entry: just its type, the entry kept, a second click gives the filter back", () => {
  const on = toggleSolo({ hidden: new Set(["trial"]), solo: null }, ["chest"], ALL, "village");
  assert.deepEqual([...on.hidden].sort(), ["coop", "crystal", "trial"]);
  assert.deepEqual(on.solo, { types: ["chest"], previous: ["trial"], entry: "village" });
  assert.equal(isSolo(on.solo, ["chest"], "village"), true);
  assert.equal(isSolo(on.solo, ["chest"]), false, "not the whole type");
  assert.equal(isSolo(on.solo, ["chest"], "academy"), false, "not another entry");
  const off = toggleSolo(on, ["chest"], ALL, "village");
  assert.deepEqual([...off.hidden], ["trial"]);
  assert.equal(off.solo, null);
});

test("from an entry to its whole type, or to another entry, keeps the filter from before", () => {
  const entry = toggleSolo({ hidden: new Set(["trial"]), solo: null }, ["chest"], ALL, "village");
  const type = toggleSolo(entry, ["chest"], ALL);
  assert.deepEqual(type.solo, { types: ["chest"], previous: ["trial"] });
  const other = toggleSolo(entry, ["chest"], ALL, "academy");
  assert.deepEqual(other.solo, { types: ["chest"], previous: ["trial"], entry: "academy" });
});

test("canSoloEntry: an entry of several markers, in a type with other entries", () => {
  const type = { entries: [{ size: 11 }, { size: 1 }] };
  assert.equal(canSoloEntry(type, type.entries[0]), true);
  assert.equal(canSoloEntry(type, type.entries[1]), false, "one marker");
  const single = { entries: [{ size: 6 }] };
  assert.equal(canSoloEntry(single, single.entries[0]), false, "the only entry of its type");
});

test("cleanSolo keeps an entry only if it is known and of the solo's type", () => {
  const entryTypes = new Map([["village", "chest"], ["peak", "crystal"]]);
  assert.deepEqual(cleanSolo({ types: ["chest"], previous: ["trial"], entry: "village" }, ALL, entryTypes),
    { types: ["chest"], previous: ["trial"], entry: "village" });
  assert.equal(cleanSolo({ types: ["chest"], previous: [], entry: "gone" }, ALL, entryTypes), null, "unknown entry");
  assert.equal(cleanSolo({ types: ["chest"], previous: [], entry: "peak" }, ALL, entryTypes), null, "another type's entry");
  assert.equal(cleanSolo({ types: ["chest", "coop"], previous: [], entry: "village" }, ALL, entryTypes), null, "several types");
  assert.equal(cleanSolo({ types: ["chest"], previous: [], entry: 3 }, ALL, entryTypes), null, "not a string");
  assert.deepEqual(cleanSolo({ types: ["chest"], previous: [] }, ALL), { types: ["chest"], previous: [] }, "a saved type solo, as before");
});
