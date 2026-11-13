import { fetchJson } from "./util.js";

// The languages the UI is translated into are listed in i18n/languages.json
// ({ "<code>": "<native name>" }). To add one, create i18n/<code>.json, add it to the
// manifest, and run tools/build_data.py so i18n/entries.<map>.<code>.json and
// i18n/markers.<map>.<code>.json exist.
export async function loadLanguages() {
  return fetchJson("i18n/languages.json", { en: "English" });
}

// Language priority: ?lang=xx, saved setting, browser languages (in order), English.
// Only languages present in the manifest are considered.
export function detectLang(settings, languages) {
  const supported = (l) => typeof l === "string" && Object.hasOwn(languages, l);
  const candidates = [
    new URLSearchParams(location.search).get("lang"),
    settings.lang,
    ...(navigator.languages ?? [navigator.language]).map((l) => l?.slice(0, 2)),
  ];
  return candidates.find(supported) ?? "en";
}

// Loads UI strings (i18n/<lang>.json), entry texts (i18n/entries.<map>.<lang>.json) and
// marker texts such as Divine Trial names and notes (i18n/markers.<map>.<lang>.json).
// Anything missing in the chosen language falls back to English.
export async function loadI18n(lang, mapId) {
  const order = lang === "en" ? ["en"] : [lang, "en"];
  const ui = await Promise.all(order.map((l) => fetchJson(`i18n/${l}.json`, {})));
  const entries = await Promise.all(order.map((l) => fetchJson(`i18n/entries.${mapId}.${l}.json`, {})));
  const markers = await Promise.all(order.map((l) => fetchJson(`i18n/markers.${mapId}.${l}.json`, {})));

  const t = (key, fallback) => {
    for (const dict of ui) if (key in dict) return dict[key];
    return fallback ?? key;
  };
  const entry = (id) => ({
    name: entries.map((d) => d[id]?.name).find(Boolean) ?? id,
    description: entries.map((d) => d[id]?.description).find(Boolean) ?? "",
  });
  // Texts of one marker: own name (Divine Trials), note and howto; "" when missing.
  const markerText = (id, field) => markers.map((d) => d[id]?.[field]).find(Boolean) ?? "";
  const marker = (id) => ({
    name: markerText(id, "name"),
    note: markerText(id, "note"),
    howto: markerText(id, "howto"),
  });
  // Translation with {placeholders}: tf("ui.exported", { n: 3 }).
  const tf = (key, vars = {}) => t(key).replace(/\{(\w+)\}/g, (m, name) => (name in vars ? String(vars[name]) : m));
  return { lang, t, tf, entry, marker };
}
