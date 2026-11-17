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
