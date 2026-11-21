// Which marker types the map shows: the hidden set, and "only this" (solo), which shows one category, or
// one entry of a type, and remembers the filter it replaced so a second click (or "Back") restores it.
// Pure: no DOM, no Leaflet.
//
// solo: null, or { types: [typeId...], previous: [hidden typeId...] }, plus `entry: entryId` when it shows
// one entry (its type is then the only one in `types`). It is saved with the settings, so "Back" still
// works after the page reloads (phones often reload a tab left in the background).

const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

// Whether `typeIds` (and `entry`, for an entry) is what is shown alone right now.
export function isSolo(solo, typeIds, entry = null) {
  return !!solo && sameSet(solo.types, typeIds) && (solo.entry ?? null) === entry;
}

// Whether an entry gets its own "only this": when it has several markers and its type has other entries
// (chest sets, crystals). An entry with one marker, or the only entry of its type, has other ways to show
// it alone (its type's "only this", its marker in the item list).
export function canSoloEntry(type, entry) {
  return entry.size > 1 && type.entries.length > 1;
}

// Clicking "only this" on `typeIds` (or on `entry`, of the single type in `typeIds`). Returns
// { hidden, solo }: shows only those, or, when they are already alone, gives back the filter from before.
// Switching from one to another keeps the filter from before the first one, so "Back" always returns to
// what the player had set.
export function toggleSolo({ hidden, solo }, typeIds, allTypeIds, entry = null) {
  if (isSolo(solo, typeIds, entry)) return endSolo(solo);
  const previous = solo ? solo.previous : [...hidden];
  return {
    hidden: new Set(allTypeIds.filter((id) => !typeIds.includes(id))),
    solo: { types: [...typeIds], previous, ...(entry ? { entry } : {}) },
  };
}

// "Back": the filter from before "only this".
export function endSolo(solo) {
  return { hidden: new Set(solo?.previous ?? []), solo: null };
}

// Types that start hidden (categories.json `defaultHidden`, e.g. the respawned chests, which only matter once
// every normal chest is open). Each one is hidden the first time a map shows it and then remembered in
// `seen`, so a player who turns it on keeps it on. Returns { hidden, seen, changed } (new sets;
// `changed`: there is something to save).
export function applyDefaultHidden(hidden, seen, defaultHiddenIds) {
  const next = { hidden: new Set(hidden), seen: new Set(seen), changed: false };
  for (const id of defaultHiddenIds) {
    if (next.seen.has(id)) continue;
    next.hidden.add(id);
    next.seen.add(id);
    next.changed = true;
  }
  return next;
}

// What "Show all" turns on: every type but the default-hidden ones, which only their own checkbox (or
// "only this", or a link to one of their markers) turns on. `types`: the model's type id -> type.
export function showAllTypeIds(allTypeIds, types) {
  return allTypeIds.filter((id) => !types.get(id)?.defaultHidden);
}

// Types that only matter once every marker of another type is found (categories.json `unlockedBy`, e.g.
// the respawned chests after the normal chests). For each: { id, after, total } (`total`: how many of
// `after` there are, for the sidebar's hint) and `nudge`: they are all found and the player has never shown
// the type (`wasShown`, see recordShown), so the sidebar suggests showing it. Hidden is not enough: "only
// this" on another category hides it too, and a player who hid it again is done with it. The site only
// knows what the player marked, so it never turns the type on by itself.
export function unlockHints(types, wasShown) {
  const out = [];
  for (const type of types.values()) {
    const after = type.unlockedBy && types.get(type.unlockedBy);
    if (!after) continue;
    const complete = after.total > 0 && after.found >= after.total;
    out.push({ id: type.id, after: after.id, total: after.total, nudge: complete && !wasShown(type.id) });
  }
  return out;
}

// The types of `typeIds` that have been on the map at least once, by any way (checkbox, "only this", a
// link): `shown` plus those visible now. Returns { shown, changed } (a new set; `changed`: something to save).
export function recordShown(shown, typeIds, isVisible) {
  const next = new Set(shown);
  for (const id of typeIds) if (isVisible(id)) next.add(id);
  return { shown: next, changed: next.size !== new Set(shown).size };
}

// A saved solo, kept only if it is well formed and names types this map has, and, for an entry, an entry
// of that type (`entryTypes`: entry id -> type id); anything else is dropped.
export function cleanSolo(value, allTypeIds, entryTypes = new Map()) {
  if (!value || typeof value !== "object" || !Array.isArray(value.types) || !Array.isArray(value.previous)) return null;
  const known = (ids) => ids.filter((id) => typeof id === "string" && allTypeIds.includes(id));
  const types = known(value.types);
  if (!types.length) return null;
  const previous = known(value.previous);
  if (value.entry === undefined) return { types, previous };
  const type = entryTypes.get(value.entry);
  if (typeof value.entry !== "string" || !type || types.length !== 1 || types[0] !== type) return null;
  return { types, previous, entry: value.entry };
}
