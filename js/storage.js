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
