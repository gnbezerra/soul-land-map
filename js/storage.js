// Versioned localStorage wrapper. Every access is guarded: storage may be empty,
// full or unavailable (private mode), and the site must keep working without it.
const SETTINGS_KEY = "slmap:v1:settings";

export function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY)) ?? {};
  } catch {
    return {};
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Ignore: settings just will not persist.
  }
}

// --- Exploration progress -------------------------------------------------------------------
// Progress is the set of marker ids the user has found, stored per map as a JSON array.
// Marker ids are permanent (never reused), so progress survives data updates.
const progressKey = (mapId) => `slmap:v1:progress:${mapId}`;

export function loadProgress(mapId) {
  try {
    const ids = JSON.parse(localStorage.getItem(progressKey(mapId)));
    return new Set(Array.isArray(ids) ? ids.filter((id) => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

// Returns false when the browser refused to store it (private mode, quota).
export function saveProgress(mapId, ids) {
  try {
    localStorage.setItem(progressKey(mapId), JSON.stringify([...ids].sort()));
    return true;
  } catch {
    return false;
  }
}

// --- Divine Trial progress ----------------------------------------------------------------
// Stages are played in order, so a trial's progress is one number: how many stages are done.
// Stored per map as { "<markerId>": <stages done> }; trials at 0 are left out.
const trialsKey = (mapId) => `slmap:v1:trials:${mapId}`;

// Keeps only positive integer values, so damaged or hand-edited data cannot break the counts.
function cleanTrials(value) {
  const trials = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return trials;
  for (const [id, n] of Object.entries(value)) {
    if (Number.isInteger(n) && n > 0) trials[id] = n;
  }
  return trials;
}

export function loadTrials(mapId) {
  try {
    return cleanTrials(JSON.parse(localStorage.getItem(trialsKey(mapId))));
  } catch {
    return {};
  }
}

// Returns false when the browser refused to store it (private mode, quota).
export function saveTrials(mapId, trials) {
  try {
    localStorage.setItem(trialsKey(mapId), JSON.stringify(cleanTrials(trials)));
    return true;
  } catch {
    return false;
  }
}

// --- Backup file --------------------------------------------------------------------------
// { "app": "soul-land-map", "version": 1, "exportedAt": "<ISO date>",
//   "progress": { "<mapId>": ["<markerId>", ...] },
//   "trials": { "<mapId>": { "<markerId>": <stages done> } } }
// `trials` is optional (older backups do not have it), so the version stays 1.
// Only progress is exported; settings (language, filters) are per device and not worth moving.
export const BACKUP_APP = "soul-land-map";
export const BACKUP_VERSION = 1;

export function buildBackup(progressByMap, trialsByMap = {}, now = new Date()) {
  const progress = {};
  for (const [mapId, ids] of Object.entries(progressByMap)) progress[mapId] = [...ids].sort();
  const trials = {};
  for (const [mapId, value] of Object.entries(trialsByMap)) {
    const clean = cleanTrials(value);
    if (Object.keys(clean).length) trials[mapId] = clean;
  }
  return { app: BACKUP_APP, version: BACKUP_VERSION, exportedAt: now.toISOString(), progress, trials };
}

// Validates untrusted file text.
// Returns { progress: { mapId: Set }, trials: { mapId: { markerId: n } } } or { error: "<reason>" }.
export function parseBackup(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { error: "not-json" };
  }
  if (!data || typeof data !== "object" || data.app !== BACKUP_APP) return { error: "not-a-backup" };
  if (data.version !== BACKUP_VERSION) return { error: "unsupported-version" };
  if (!data.progress || typeof data.progress !== "object" || Array.isArray(data.progress)) return { error: "malformed" };
  const progress = {};
  for (const [mapId, ids] of Object.entries(data.progress)) {
    if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string")) return { error: "malformed" };
    progress[mapId] = new Set(ids);
  }
  const trials = {};
  if (data.trials !== undefined) {
    if (!data.trials || typeof data.trials !== "object" || Array.isArray(data.trials)) return { error: "malformed" };
    for (const [mapId, value] of Object.entries(data.trials)) {
      const ok = value && typeof value === "object" && !Array.isArray(value) &&
        Object.values(value).every((n) => Number.isInteger(n) && n >= 0);
      if (!ok) return { error: "malformed" };
      trials[mapId] = cleanTrials(value);
    }
  }
  return { progress, trials };
}
