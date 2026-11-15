// Builds the filter/sidebar model from categories, entries and markers.
// Pure data logic: no DOM and no Leaflet, so it is easy to test.

// Counter text for a type, entry or group: found / total.
export function formatCount(found, total) {
  return `${found}/${total}`;
}

// Divine Trial layers are played in order, so progress is the number of layers done. Clicking a layer
// that is not done marks it and the ones before it; clicking a done layer unmarks it and the ones after.
//   nextTrialProgress(8, 5) -> 4      nextTrialProgress(4, 7) -> 7
export function nextTrialProgress(done, clicked) {
  return clicked <= done ? clicked - 1 : clicked;
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
      // stagesById: markers that count per stage (Divine Trials), id -> number of stages.
      types.set(id, { id, ...categories.types[id], loaded: 0, expected: null, total: 0, found: 0, markerIds: [], stagesById: new Map(), entries: [] });
    }
    return types.get(id);
  }

  const entryById = new Map();
  for (const [id, e] of Object.entries(entries)) {
    const type = getType(e.type);
    if (!type) continue;
    const entry = { id, size: e.size, loaded: 0, found: 0, markerIds: [], tags: e.tags ?? [] };
    type.expected = (type.expected ?? 0) + e.size;
    type.entries.push(entry);
    entryById.set(id, entry);
  }

  // A marker counts once, even if it has several points (e.g. some encounters).
  // A Divine Trial counts once per stage, like the game's counter.
  for (const m of markers) {
    const type = getType(m.type);
    if (!type) continue;
    const stages = m.stages?.length ?? 0;
    type.loaded += stages || 1;
    type.markerIds.push(m.id);
    if (stages) type.stagesById.set(m.id, stages);
    if (m.entry && entryById.has(m.entry)) {
      const entry = entryById.get(m.entry);
      entry.loaded++;
      entry.markerIds.push(m.id);
    }
  }
  // The total is what the game says exists; before an entry list exists, the mapped count.
  for (const type of types.values()) type.total = type.expected ?? type.loaded;

  // Groups keep the order of categories.json; types with no entries and no markers are hidden.
  const groups = [];
  for (const g of categories.groups) {
    const groupTypes = g.types
      .map((id) => types.get(id))
      .filter((t) => t && (t.expected != null || t.loaded > 0));
    if (groupTypes.length === 0) continue;
    groups.push({ id: g.id, countsForExploration: g.countsForExploration, types: groupTypes, found: 0, total: 0 });
  }
  const model = { groups, types, entryById, unknownTypes: [...unknownTypes] };
  applyProgress(model, new Set(), {});
  return model;
}

// Recomputes every `found` and group counter from the set of found marker ids and the
// Divine Trial progress (id -> stages done; a trial counts its done stages, never more than it has).
// Ids that no longer exist in the data are ignored, so stale progress never inflates counts.
export function applyProgress(model, foundIds, trials) {
  for (const type of model.types.values()) {
    const done = (id) => {
      const stages = type.stagesById.get(id);
      if (stages) return Math.min(trials[id] ?? 0, stages);
      return foundIds.has(id) ? 1 : 0;
    };
    const countFound = (ids) => ids.reduce((n, id) => n + done(id), 0);
    type.found = countFound(type.markerIds);
    for (const entry of type.entries) entry.found = countFound(entry.markerIds);
  }
  for (const g of model.groups) {
    g.found = g.types.reduce((n, t) => n + t.found, 0);
    g.total = g.types.reduce((n, t) => n + t.total, 0);
  }
  // Overall exploration: only the categories the game counts towards exploration.
  const counted = model.groups.filter((g) => g.countsForExploration);
  model.exploration = {
    found: counted.reduce((n, g) => n + g.found, 0),
    total: counted.reduce((n, g) => n + g.total, 0),
  };
}
