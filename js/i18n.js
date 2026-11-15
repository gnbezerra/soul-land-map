// Language detection and translated texts. Pure: the page's environment (URL query, browser languages)
// and the JSON loader are passed in by js/app.js, so Node can test all of it.
//
// The languages the UI is translated into are listed in i18n/languages.json
// ({ "<code>": "<native name>" }, lowercase codes). To add one, create i18n/<code>.json, add it to the
// manifest, and run tools/build_data.py so i18n/entries.<map>.<code>.json and
// i18n/markers.<map>.<code>.json exist.

// `fetchJson(url, fallback)` resolves to the parsed file, or to `fallback` when the file is missing.
export async function loadLanguages(fetchJson) {
  return fetchJson("i18n/languages.json", { en: "English" });
}

// Language priority: ?lang=xx, saved setting, browser languages (in order), English. Only languages in
// the manifest are considered. Codes are matched case-insensitively on their first two letters, so
// ?lang=PT, "pt-BR" and "zh-CN" work.
//   detectLang(languages, { query: location.search, saved: settings.lang, browser: navigator.languages })
export function detectLang(languages, { query = "", saved, browser = [] } = {}) {
  const code = (l) => (typeof l === "string" ? l.slice(0, 2).toLowerCase() : null);
  const candidates = [new URLSearchParams(query).get("lang"), saved, ...browser].map(code);
  return candidates.find((l) => l && Object.hasOwn(languages, l)) ?? "en";
}

// Loads UI strings (i18n/<lang>.json), entry texts (i18n/entries.<map>.<lang>.json) and
// marker texts such as Divine Trial names and notes (i18n/markers.<map>.<lang>.json).
// Anything missing in the chosen language falls back to English.
export async function loadI18n(lang, mapId, fetchJson) {
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
