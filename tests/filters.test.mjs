// Tests for js/filters.js. Run: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { isSolo, toggleSolo, endSolo, cleanSolo, canSoloEntry, applyDefaultHidden, showAllTypeIds, unlockHints } from "../js/filters.js";

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

test("default-hidden types start hidden once, then the player's choice stays", () => {
  const first = applyDefaultHidden(new Set(["trial"]), [], ["respawn"]);
  assert.deepEqual([...first.hidden].sort(), ["respawn", "trial"]);
  assert.deepEqual([...first.seen], ["respawn"]);
  assert.equal(first.changed, true);
  // The player turned it on: seen already, so it is not hidden again.
  const later = applyDefaultHidden(new Set(["trial"]), ["respawn"], ["respawn"]);
  assert.deepEqual([...later.hidden], ["trial"]);
  assert.equal(later.changed, false);
});

test("applyDefaultHidden leaves its inputs alone and ignores types with no default", () => {
  const hidden = new Set();
  const seen = [];
  const out = applyDefaultHidden(hidden, seen, []);
  assert.equal(out.changed, false);
  assert.deepEqual([...out.hidden], []);
  applyDefaultHidden(hidden, seen, ["respawn"]);
  assert.equal(hidden.size, 0);
  assert.equal(seen.length, 0);
});

test("show all leaves the default-hidden types alone", () => {
  const types = new Map([["chest", { id: "chest" }], ["respawn", { id: "respawn", defaultHidden: true }]]);
  assert.deepEqual(showAllTypeIds(["chest", "respawn", "gone"], types), ["chest", "gone"]);
});

test("unlock hints: the total to find, and a nudge once it is all found and the type is hidden", () => {
  const types = new Map([
    ["chest", { id: "chest", total: 3, found: 2 }],
    ["respawn", { id: "respawn", unlockedBy: "chest" }],
    ["crystal", { id: "crystal", total: 1, found: 1 }],
    ["orphan", { id: "orphan", unlockedBy: "missing" }],
  ]);
  const hidden = new Set(["respawn"]);
  assert.deepEqual(unlockHints(types, (id) => hidden.has(id)), [{ id: "respawn", after: "chest", total: 3, nudge: false }]);
  types.get("chest").found = 3;
  assert.equal(unlockHints(types, (id) => hidden.has(id))[0].nudge, true, "all found, still hidden");
  hidden.clear();
  assert.equal(unlockHints(types, (id) => hidden.has(id))[0].nudge, false, "already shown");
  types.get("chest").total = 0;
  types.get("chest").found = 0;
  hidden.add("respawn");
  assert.equal(unlockHints(types, (id) => hidden.has(id))[0].nudge, false, "nothing to find is not complete");
});
