// Tests for js/i18n.js. Run: node --test tests/
// Uses made-up texts served by a fake fetchJson, so editing the real i18n files never breaks them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { detectLang, loadI18n, loadLanguages } from "../js/i18n.js";

const languages = { en: "English", pt: "Português", zh: "简体中文" };

// Serves `files` ({ url: data }) like js/util.js's fetchJson: a missing file yields the fallback, or throws
// when there is none. Records every requested url.
function fakeFetch(files) {
  const requested = [];
  const fetchJson = async (url, fallback) => {
    requested.push(url);
    if (Object.hasOwn(files, url)) return structuredClone(files[url]);
    if (fallback !== undefined) return fallback;
    throw new Error(`${url}: HTTP 404`);
  };
  return { fetchJson, requested };
}

const FILES = {
  "i18n/en.json": { "ui.title": "Map", "ui.only.en": "English only", "ui.exported": "Saved {n} of {total}" },
  "i18n/pt.json": { "ui.title": "Mapa", "ui.exported": "Salvos {n} de {total}" },
  "i18n/entries.m.en.json": { "set-a": { name: "Set A", description: "Three chests." }, "set-b": { name: "Set B" } },
  "i18n/entries.m.pt.json": { "set-a": { name: "Conjunto A" } },
  "i18n/markers.m.en.json": { "m-0001": { name: "Trial", note: "On the roof.", howto: "Jump." } },
  "i18n/markers.m.pt.json": { "m-0001": { note: "No telhado." } },
};

test("detectLang: ?lang first, then the saved setting, then the browser, then English", () => {
  const all = { query: "?lang=zh", saved: "pt", browser: ["en-US"] };
  assert.equal(detectLang(languages, all), "zh");
  assert.equal(detectLang(languages, { ...all, query: "" }), "pt");
  assert.equal(detectLang(languages, { ...all, query: "", saved: undefined }), "en");
  assert.equal(detectLang(languages, { browser: ["fr-FR", "pt-BR", "zh-CN"] }), "pt", "first supported browser language");
  assert.equal(detectLang(languages, { browser: ["fr", "de"] }), "en", "none supported");
  assert.equal(detectLang(languages, {}), "en");
  assert.equal(detectLang(languages), "en", "no environment at all");
});

test("detectLang: languages not in the manifest are skipped", () => {
  assert.equal(detectLang(languages, { query: "?lang=fr", saved: "pt" }), "pt");
  assert.equal(detectLang({ en: "English" }, { query: "?lang=pt", browser: ["pt-BR"] }), "en", "pt not offered");
  assert.equal(detectLang(languages, { query: "?lang=", saved: "zh" }), "zh", "empty ?lang");
  assert.equal(detectLang(languages, { query: "?other=1&lang=pt" }), "pt", "other query parameters");
});

test("detectLang: codes match case-insensitively on their first two letters", () => {
  for (const lang of Object.keys(languages)) {
    assert.equal(detectLang(languages, { query: `?lang=${lang.toUpperCase()}` }), lang, `?lang=${lang.toUpperCase()}`);
  }
  assert.equal(detectLang(languages, { query: "?lang=Pt-BR" }), "pt");
  assert.equal(detectLang(languages, { saved: "ZH" }), "zh");
  assert.equal(detectLang(languages, { browser: ["PT-br"] }), "pt");
});

test("detectLang ignores values that are not strings", () => {
  assert.equal(detectLang(languages, { saved: 42, browser: [null, undefined, "zh-TW"] }), "zh");
});

test("loadLanguages reads the manifest, or offers only English without one", async () => {
  assert.deepEqual(await loadLanguages(fakeFetch({ "i18n/languages.json": languages }).fetchJson), languages);
  assert.deepEqual(await loadLanguages(fakeFetch({}).fetchJson), { en: "English" });
});

test("loadI18n loads the language and English, and English alone for English", async () => {
  const pt = fakeFetch(FILES);
  assert.equal((await loadI18n("pt", "m", pt.fetchJson)).lang, "pt");
  assert.deepEqual(pt.requested.sort(), Object.keys(FILES).sort());
  const en = fakeFetch(FILES);
  await loadI18n("en", "m", en.fetchJson);
  assert.deepEqual(en.requested.sort(), ["i18n/en.json", "i18n/entries.m.en.json", "i18n/markers.m.en.json"]);
});

test("t falls back to English per key, then to the given fallback, then to the key", async () => {
  const { t } = await loadI18n("pt", "m", fakeFetch(FILES).fetchJson);
  assert.equal(t("ui.title"), "Mapa");
  assert.equal(t("ui.only.en"), "English only");
  assert.equal(t("type.unknown", "unknown"), "unknown");
  assert.equal(t("type.unknown"), "type.unknown");
});

test("tf fills {placeholders} and leaves unknown ones as they are", async () => {
  const { tf } = await loadI18n("pt", "m", fakeFetch(FILES).fetchJson);
  assert.equal(tf("ui.exported", { n: 3, total: 0 }), "Salvos 3 de 0");
  assert.equal(tf("ui.exported", { n: 3 }), "Salvos 3 de {total}");
  assert.equal(tf("ui.title"), "Mapa");
});

test("entry texts fall back to English per field, and to the id", async () => {
  const { entry } = await loadI18n("pt", "m", fakeFetch(FILES).fetchJson);
  assert.deepEqual(entry("set-a"), { name: "Conjunto A", description: "Three chests." });
  assert.deepEqual(entry("set-b"), { name: "Set B", description: "" });
  assert.deepEqual(entry("set-x"), { name: "set-x", description: "" });
});

test("marker texts fall back to English per field, and to empty strings", async () => {
  const { marker } = await loadI18n("pt", "m", fakeFetch(FILES).fetchJson);
  assert.deepEqual(marker("m-0001"), { name: "Trial", note: "No telhado.", howto: "Jump." });
  assert.deepEqual(marker("m-0999"), { name: "", note: "", howto: "" });
});

test("missing text files are treated as empty", async () => {
  const { t, entry, marker } = await loadI18n("zh", "m", fakeFetch({ "i18n/en.json": FILES["i18n/en.json"] }).fetchJson);
  assert.equal(t("ui.title"), "Map");
  assert.deepEqual(entry("set-a"), { name: "set-a", description: "" });
  assert.deepEqual(marker("m-0001"), { name: "", note: "", howto: "" });
});
