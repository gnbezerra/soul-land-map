// Tests for js/version.js. Run: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatDataDate, parseVersion } from "../js/version.js";

const SHA = "565548f0123456789abcdef0123456789abcdef0";

test("parseVersion reads the deployed commit and the data date", () => {
  assert.deepEqual(parseVersion({ commit: SHA, dataDate: "2026-11-21" }), {
    commit: SHA,
    short: "565548f",
    url: `https://github.com/gnbezerra/soul-land-map/commit/${SHA}`,
    dataDate: "2026-11-21",
  });
});

test("parseVersion shows nothing for the committed placeholder or a missing file", () => {
  assert.equal(parseVersion({ commit: null, dataDate: null }), null);
  assert.equal(parseVersion(null), null);
  assert.equal(parseVersion(undefined), null);
});

test("parseVersion rejects a commit that is not a hex sha", () => {
  assert.equal(parseVersion({ commit: "main", dataDate: "2026-11-21" }), null);
  assert.equal(parseVersion({ commit: "<script>", dataDate: "2026-11-21" }), null);
  assert.equal(parseVersion({ commit: 42 }), null);
});

test("parseVersion keeps the commit when only the date is bad", () => {
  for (const dataDate of [null, "", "21/11/2026", "2026-13-45", "2026-11-21T10:00:00Z", 20261121]) {
    assert.equal(parseVersion({ commit: SHA, dataDate })?.dataDate, null, String(dataDate));
    assert.equal(parseVersion({ commit: SHA, dataDate })?.short, "565548f", String(dataDate));
  }
});

test("formatDataDate writes the day in each language's own format", () => {
  assert.equal(formatDataDate("2026-11-21", "en"), "Nov 21, 2026");
  assert.equal(formatDataDate("2026-11-21", "pt"), "21 de nov. de 2026");
  assert.equal(formatDataDate("2026-11-21", "zh"), "2026年11月21日");
});

test("formatDataDate keeps the calendar day (no time zone shift)", () => {
  assert.match(formatDataDate("2026-01-01", "en"), /Jan 1, 2026/);
  assert.match(formatDataDate("2026-12-31", "en"), /Dec 31, 2026/);
});
