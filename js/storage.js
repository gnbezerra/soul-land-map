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

// --- Backup file --------------------------------------------------------------------------
// { "app": "soul-land-map", "version": 1, "exportedAt": "<ISO date>", "progress": { "<mapId>": ["<markerId>", ...] } }
// Only progress is exported; settings (language, filters) are per device and not worth moving.
export const BACKUP_APP = "soul-land-map";
export const BACKUP_VERSION = 1;

export function buildBackup(progressByMap, now = new Date()) {
  const progress = {};
  for (const [mapId, ids] of Object.entries(progressByMap)) progress[mapId] = [...ids].sort();
  return { app: BACKUP_APP, version: BACKUP_VERSION, exportedAt: now.toISOString(), progress };
}

// Validates untrusted file text. Returns { progress: { mapId: Set } } or { error: "<reason>" }.
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
  return { progress };
}
