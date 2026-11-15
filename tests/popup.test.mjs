// Tests for js/popup.js. Run: node --test tests/
// Uses made-up markers and texts, so editing the real data never breaks them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { markerTitle, effectiveTags, popupFields, consumesContract, POPUP_FIELDS } from "../js/popup.js";

// The part of js/i18n.js's object that popup.js reads.
function fakeI18n({ ui = {}, entries = {}, markers = {} } = {}) {
  return {
    t: (key, fallback) => ui[key] ?? fallback ?? key,
    entry: (id) => ({ name: entries[id] ?? id, description: "" }),
    marker: (id) => ({ name: markers[id] ?? "", note: "", howto: "" }),
  };
}
const i18n = fakeI18n({
  ui: { "type.book": "Book", "type.chest_normal": "Normal Chest", "contract.wood": "Dragonwood" },
  entries: { "set-a": "Set A" },
  markers: { "m-0003": "The Book of Tang" },
});

test("markerTitle: own name, then the entry name with the marker's number, then the type", () => {
  assert.equal(markerTitle({ id: "m-0003", type: "book" }, i18n), "The Book of Tang");
  assert.equal(markerTitle({ id: "m-0001", type: "chest_normal", entry: "set-a", entryIndex: 4 }, i18n), "Set A #4");
  assert.equal(markerTitle({ id: "m-0001", type: "chest_normal", entry: "set-a" }, i18n), "Set A");
  assert.equal(markerTitle({ id: "m-0009", type: "book" }, i18n), "Book");
});

test("effectiveTags: the entry's tags, then the marker's own, without repeats", () => {
  const entries = { "set-a": { tags: ["purple_demon_eye", "hidden"] }, "set-b": {} };
  assert.deepEqual(effectiveTags({ entry: "set-a", tags: ["grappling_hook"] }, entries),
    ["purple_demon_eye", "hidden", "grappling_hook"]);
  assert.deepEqual(effectiveTags({ entry: "set-a", tags: ["hidden"] }, entries), ["purple_demon_eye", "hidden"]);
  assert.deepEqual(effectiveTags({ entry: "set-b" }, entries), []);
  assert.deepEqual(effectiveTags({ tags: ["guarded"] }, entries), ["guarded"], "no entry");
  assert.deepEqual(effectiveTags({ entry: "gone" }, entries), [], "entry not in the data");
});

test("popupFields: only the fields a marker has, in order, with readable values", () => {
  const m = { type: "chest_challenge", players: 2, pillar: { x: 557, y: 505.5 }, to: "", seed: null };
  assert.deepEqual(popupFields(m, i18n), [
    { field: "players", value: "2" },
    { field: "pillar", value: "X 557, Y 505.5" },
  ]);
  assert.deepEqual(popupFields({ type: "chest_normal" }, i18n), []);
});

test("popupFields: contracts show their name, falling back to the code", () => {
  assert.deepEqual(popupFields({ type: "chest_contract", contract: "wood" }, i18n), [{ field: "contract", value: "Dragonwood" }]);
  assert.deepEqual(popupFields({ type: "chest_contract", contract: "frost" }, i18n), [{ field: "contract", value: "frost" }]);
});

test("popupFields: a Divine Trial shows its subtype in the type line, not as a field", () => {
  assert.deepEqual(popupFields({ type: "divine_trial", subtype: "combat", stages: [{ stars: 1 }] }, i18n), []);
  assert.deepEqual(popupFields({ type: "divine_trial", subtype: "combat" }, i18n), [{ field: "subtype", value: "combat" }],
    "a trial without stages yet");
});

test("every popup field has a place in the list", () => {
  assert.equal(new Set(POPUP_FIELDS).size, POPUP_FIELDS.length);
});

test("only contract chests warn that the contract is used up", () => {
  assert.equal(consumesContract({ type: "chest_contract" }), true);
  assert.equal(consumesContract({ type: "chest_coop" }), false);
});
