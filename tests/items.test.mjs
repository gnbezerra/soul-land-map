// Tests for js/items.js. Run: node --test tests/
// Uses made-up markers and texts, so editing the real data never breaks them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { hasItemList, shortTitle, typeItems, ITEM_LIST_MAX } from "../js/items.js";

function fakeI18n({ ui = {}, entries = {}, markers = {} } = {}) {
  return {
    t: (key, fallback) => ui[key] ?? fallback ?? key,
    entry: (id) => ({ name: entries[id] ?? id, description: "" }),
    marker: (id) => ({ name: markers[id] ?? "", note: "", howto: "" }),
  };
}
const i18n = fakeI18n({
  ui: { "type.portal": "Portal" },
  entries: { "coop-1": "Cooperative Chest One", "meet-a": "Two Friends" },
  markers: {
    "m-1": "Trial of Wisdom: Totem of Mind Essence", "m-2": "Trial of Wisdom: Memory Link",
    "m-3": "Trial of Wisdom: Totem of Mind Essence", "m-4": "智之试炼·记忆链接", "m-5": "A Book",
  },
});
const type = (sizes) => ({ entries: sizes.map((size, i) => ({ id: `e${i}`, size })) });

test("hasItemList: small types whose markers each have a title of their own", () => {
  const trials = [{ id: "m-1", type: "divine_trial" }, { id: "m-2", type: "divine_trial" }];
  assert.equal(hasItemList(type([]), trials, i18n), true, "no entries");
  assert.equal(hasItemList(type([1, 1]), [{ id: "x", entry: "coop-1" }, { id: "y", entry: "coop-1" }], i18n), true,
    "entries of one marker");
  assert.equal(hasItemList(type([1, 3]), trials, i18n), false, "an entry with several markers keeps the entry list");
  assert.equal(hasItemList(type([]), [{ id: "p-1", type: "portal" }], i18n), false, "an item would read just 'Portal'");
  assert.equal(hasItemList(type([]), [], i18n), false, "no markers");
  const many = Array.from({ length: ITEM_LIST_MAX + 1 }, (_, i) => ({ id: "m-5", n: i }));
  assert.equal(hasItemList(type([]), many, i18n), false, "too many");
});

test("shortTitle drops a Divine Trial's kind, in any language; other types keep their title", () => {
  assert.equal(shortTitle({ type: "divine_trial" }, "Trial of Wisdom: Memory Link"), "Memory Link");
  assert.equal(shortTitle({ type: "divine_trial" }, "智之试炼·记忆链接"), "记忆链接");
  assert.equal(shortTitle({ type: "divine_trial" }, "Plain"), "Plain");
  assert.equal(shortTitle({ type: "book" }, "Legend: The Book"), "Legend: The Book");
});

test("typeItems: labels in the data's order, repeated names numbered", () => {
  const markers = ["m-1", "m-2", "m-3"].map((id) => ({ id, type: "divine_trial" }));
  assert.deepEqual(typeItems(markers, i18n), [
    { id: "m-1", label: "Totem of Mind Essence", n: 1 },
    { id: "m-2", label: "Memory Link", n: null },
    { id: "m-3", label: "Totem of Mind Essence", n: 2 },
  ]);
  assert.deepEqual(typeItems([{ id: "c", type: "encounter", entry: "meet-a" }], i18n), [{ id: "c", label: "Two Friends", n: null }]);
});
