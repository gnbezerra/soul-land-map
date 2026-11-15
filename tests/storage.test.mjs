// Tests for js/storage.js. Run: node --test tests/
// localStorage is replaced by an in-memory fake (or one that throws) before each test.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  loadSettings, saveSettings, loadProgress, saveProgress, loadTrials, saveTrials, buildBackup, parseBackup,
} from "../js/storage.js";

let store;
function memoryStorage() {
  store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
  };
}
function brokenStorage() {
  globalThis.localStorage = {
    getItem() { throw new Error("denied"); },
    setItem() { throw new Error("quota"); },
  };
}
beforeEach(memoryStorage);

const backupText = (extra) => JSON.stringify({ app: "soul-land-map", version: 1, progress: {}, ...extra });

test("settings round trip; empty or bad data gives {}", () => {
  assert.deepEqual(loadSettings(), {});
  saveSettings({ lang: "pt" });
  assert.deepEqual(loadSettings(), { lang: "pt" });
  store.set("slmap:v1:settings", "{oops");
  assert.deepEqual(loadSettings(), {});
});

test("progress: sorted array in storage, non-strings dropped", () => {
  assert.equal(saveProgress("nuoding", new Set(["b", "a"])), true);
  assert.equal(store.get("slmap:v1:progress:nuoding"), '["a","b"]');
  store.set("slmap:v1:progress:nuoding", '["a", 3, null, "b"]');
  assert.deepEqual([...loadProgress("nuoding")], ["a", "b"]);
  store.set("slmap:v1:progress:nuoding", '{"a": 1}');
  assert.deepEqual([...loadProgress("nuoding")], []);
});

test("trials: only positive integers are kept, on load and on save", () => {
  assert.deepEqual(loadTrials("nuoding"), {});
  store.set("slmap:v1:trials:nuoding", JSON.stringify({ a: 3, b: 0, c: -1, d: 1.5, e: "2", f: null }));
  assert.deepEqual(loadTrials("nuoding"), { a: 3 });
  store.set("slmap:v1:trials:nuoding", "[1, 2]");
  assert.deepEqual(loadTrials("nuoding"), {});
  store.set("slmap:v1:trials:nuoding", "not json");
  assert.deepEqual(loadTrials("nuoding"), {});
  assert.equal(saveTrials("nuoding", { x: 2, y: 0 }), true);
  assert.equal(store.get("slmap:v1:trials:nuoding"), '{"x":2}');
});

test("unavailable storage: loads are empty, saves report failure, nothing throws", () => {
  brokenStorage();
  assert.deepEqual(loadSettings(), {});
  assert.doesNotThrow(() => saveSettings({ lang: "pt" }));
  assert.deepEqual([...loadProgress("nuoding")], []);
  assert.equal(saveProgress("nuoding", new Set(["a"])), false);
  assert.deepEqual(loadTrials("nuoding"), {});
  assert.equal(saveTrials("nuoding", { a: 1 }), false);
});

test("backup round trip, with trials; maps without trials are left out", () => {
  const backup = buildBackup({ nuoding: new Set(["b", "a"]) }, { nuoding: { x: 2, y: 0 }, other: {} }, new Date(0));
  assert.deepEqual(backup, {
    app: "soul-land-map", version: 1, exportedAt: "1970-01-01T00:00:00.000Z",
    progress: { nuoding: ["a", "b"] }, trials: { nuoding: { x: 2 } },
  });
  const parsed = parseBackup(JSON.stringify(backup));
  assert.deepEqual([...parsed.progress.nuoding], ["a", "b"]);
  assert.deepEqual(parsed.trials, { nuoding: { x: 2 } });
});

test("a backup without trials (older version of the site) still imports", () => {
  const parsed = parseBackup(backupText({ progress: { nuoding: ["a"] } }));
  assert.deepEqual([...parsed.progress.nuoding], ["a"]);
  assert.deepEqual(parsed.trials, {});
});

test("zero layers is valid in a backup and dropped", () => {
  assert.deepEqual(parseBackup(backupText({ trials: { nuoding: { x: 0 } } })).trials, { nuoding: {} });
});

test("backup errors", () => {
  assert.equal(parseBackup("{oops").error, "not-json");
  assert.equal(parseBackup("null").error, "not-a-backup");
  assert.equal(parseBackup(JSON.stringify({ app: "other", version: 1, progress: {} })).error, "not-a-backup");
  assert.equal(parseBackup(backupText({ version: 2 })).error, "unsupported-version");
  for (const progress of [null, [], { nuoding: "a" }, { nuoding: [1] }]) {
    assert.equal(parseBackup(backupText({ progress })).error, "malformed", JSON.stringify(progress));
  }
  for (const trials of [null, [], 5, { nuoding: [] }, { nuoding: null }, { nuoding: { x: "3" } },
    { nuoding: { x: -1 } }, { nuoding: { x: 1.5 } }]) {
    assert.equal(parseBackup(backupText({ trials })).error, "malformed", JSON.stringify(trials));
  }
});
