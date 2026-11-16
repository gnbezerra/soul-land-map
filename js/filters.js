// Which marker types the map shows: the hidden set, and "only this" (solo), which shows one category and
// remembers the filter it replaced so a second click (or "Back") restores it. Pure: no DOM, no Leaflet.
//
// solo: null, or { types: [typeId...], previous: [hidden typeId...] }. It is saved with the settings, so
// "Back" still works after the page reloads (phones often reload a tab left in the background).

const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

// Whether `typeIds` is the category shown alone right now.
export function isSolo(solo, typeIds) {
  return !!solo && sameSet(solo.types, typeIds);
}

// Clicking "only this" on `typeIds`. Returns { hidden, solo }: shows only those types, or, when they are
// already alone, gives back the filter from before. Switching from one category to another keeps the
// filter from before the first one, so "Back" always returns to what the player had set.
export function toggleSolo({ hidden, solo }, typeIds, allTypeIds) {
  if (isSolo(solo, typeIds)) return endSolo(solo);
  const previous = solo ? solo.previous : [...hidden];
  return {
    hidden: new Set(allTypeIds.filter((id) => !typeIds.includes(id))),
    solo: { types: [...typeIds], previous },
  };
}

// "Back": the filter from before "only this".
export function endSolo(solo) {
  return { hidden: new Set(solo?.previous ?? []), solo: null };
}

// A saved solo, kept only if it is well formed and names types this map has; anything else is dropped.
export function cleanSolo(value, allTypeIds) {
  if (!value || typeof value !== "object" || !Array.isArray(value.types) || !Array.isArray(value.previous)) return null;
  const known = (ids) => ids.filter((id) => typeof id === "string" && allTypeIds.includes(id));
  const types = known(value.types);
  if (!types.length) return null;
  return { types, previous: known(value.previous) };
}
