// Builds the filter/sidebar model from categories, entries and markers.
// Pure data logic: no DOM and no Leaflet, so it is easy to test.
import { stageCount, stagesDone } from "./trials.js";
import { explorationValue } from "./exploration.js";

// Counter text for a type, entry or group: found / total.
export function formatCount(found, total) {
  return `${found}/${total}`;
}

// Progress of one map as the backup messages report it: found markers (Divine Trials not included) and
// Divine Trial layers done. Ids that are not in `markers` are ignored, like in the counters.
export function countProgress(markers, foundIds, trials) {
  let found = 0;
  let layers = 0;
  for (const m of markers) {
    const stages = stageCount(m);
    if (stages) layers += stagesDone(trials[m.id], stages);
    else if (foundIds.has(m.id)) found++;
  }
  return { markers: found, layers };
}

// The tag of the site's own entries for what the game counts but lists in no entry (SPEC 4.3).
export const UNLISTED_TAG = "unlisted";

export function isUnlisted(entry) {
  return (entry.tags ?? []).includes(UNLISTED_TAG);
}

// A type's entries for the sidebar: the game's, in their order, then the site's own.
export function splitUnlisted(entries) {
  return { listed: entries.filter((e) => !isUnlisted(e)), unlisted: entries.filter(isUnlisted) };
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
    const stages = stageCount(m);
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
    groups.push({ id: g.id, types: groupTypes, found: 0, total: 0 });
  }
  const explorationRules = categories.explorationRules ?? [];
  const model = { groups, types, entryById, explorationRules, unknownTypes: [...unknownTypes] };
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
      if (stages) return stagesDone(trials[id], stages);
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
  // Overall exploration value, in the game's points (js/exploration.js).
  model.exploration = explorationValue(model, model.explorationRules);
}
