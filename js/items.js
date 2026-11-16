// The sidebar's list of single markers, for small types whose entries are one marker each (or that have
// no entries): Divine Trials, encounters, books, each kind of decryption chest. Clicking an item opens
// that marker. Pure: no DOM, no Leaflet.
import { markerTitle } from "./popup.js";

// Above this many markers a type is not listed one by one.
export const ITEM_LIST_MAX = 20;

// Whether a type gets an item list: it has no entry with several markers (those keep their entry list),
// few enough markers, and every marker has a title of its own (a name or an entry), so no item would
// read just "Portal".
export function hasItemList(type, markers, i18n) {
  if (type.entries.some((e) => e.size > 1)) return false;
  if (!markers.length || markers.length > ITEM_LIST_MAX) return false;
  return markers.every((m) => i18n.marker(m.id).name || m.entry);
}

// A Divine Trial's name without its kind ("Trial of Wisdom: Memory Link" -> "Memory Link"; Chinese
// "智之试炼·记忆链接" -> "记忆链接"): the list sits under "Divine Trials" and the popup keeps the full name.
export function shortTitle(m, title) {
  if (m.type !== "divine_trial") return title;
  const cut = title.search(/: |·/);
  return cut > 0 ? title.slice(cut).replace(/^(: |·)/, "") : title;
}

// [{ id, label, n }] in the data's order. The game repeats some names (three "Totem of Mind Essence"
// trials in Suotuo): those get n = 1, 2, 3... in that order; a unique name has n = null.
export function typeItems(markers, i18n) {
  const items = markers.map((m) => ({ id: m.id, label: shortTitle(m, markerTitle(m, i18n)), n: null }));
  const seen = new Map();
  for (const item of items) seen.set(item.label, (seen.get(item.label) ?? 0) + 1);
  const next = new Map();
  for (const item of items) {
    if (seen.get(item.label) < 2) continue;
    next.set(item.label, (next.get(item.label) ?? 0) + 1);
    item.n = next.get(item.label);
  }
  return items;
}
