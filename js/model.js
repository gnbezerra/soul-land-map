// Builds the filter/sidebar model from categories, entries and markers.
// Pure data logic: no DOM and no Leaflet, so it is easy to test.

// Counter text for a type or group. Step 3 will switch this to found/total progress.
export function formatCount(loaded, expected) {
  return expected == null ? String(loaded) : `${loaded}/${expected}`;
}

export function buildModel(categories, entries, markers) {
  const types = new Map();
  const unknownTypes = new Set();

  function getType(id) {
    if (!categories.types[id]) {
      unknownTypes.add(id);
      return null;
    }
    if (!types.has(id)) {
      types.set(id, { id, ...categories.types[id], loaded: 0, expected: null, entries: [] });
    }
    return types.get(id);
  }

  const entryById = new Map();
  for (const [id, e] of Object.entries(entries)) {
    const type = getType(e.type);
    if (!type) continue;
    const entry = { id, size: e.size, loaded: 0, tags: e.tags ?? [] };
    type.expected = (type.expected ?? 0) + e.size;
    type.entries.push(entry);
    entryById.set(id, entry);
  }

  // A marker counts once, even if it has several points (e.g. some encounters).
  for (const m of markers) {
    const type = getType(m.type);
    if (!type) continue;
    type.loaded++;
    if (m.entry && entryById.has(m.entry)) entryById.get(m.entry).loaded++;
  }

  // Groups keep the order of categories.json; types with no entries and no markers are hidden.
  const groups = [];
  for (const g of categories.groups) {
    const groupTypes = g.types
      .map((id) => types.get(id))
      .filter((t) => t && (t.expected != null || t.loaded > 0));
    if (groupTypes.length === 0) continue;
    const sum = (key) => groupTypes.reduce((acc, t) => acc + (t[key] ?? 0), 0);
    groups.push({
      id: g.id,
      countsForExploration: g.countsForExploration,
      types: groupTypes,
      loaded: sum("loaded"),
      expected: groupTypes.every((t) => t.expected != null) ? sum("expected") : null,
    });
  }
  return { groups, types, entryById, unknownTypes: [...unknownTypes] };
}
