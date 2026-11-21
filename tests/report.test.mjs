// Tests for js/report.js. Run: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { reportBody, reportUrl } from "../js/report.js";

const t = (key) => ({ "ui.reportWhat": "O que está errado:", "ui.reportScreenshot": "Print do jogo:" })[key] ?? key;
const VERSION = { commit: "565548f0123456789abcdef0123456789abcdef0", short: "565548f", url: "", dataDate: "2026-11-21" };
const PAGE = "https://example.org/soul-land-map/?lang=pt#suotuo/suotuo-0042";

test("reportBody has the two prompts in the player's language, then the page, version and language", () => {
  assert.equal(reportBody({ pageUrl: PAGE, version: VERSION, lang: "pt", t }), [
    "**O que está errado:**",
    "",
    "",
    "**Print do jogo:**",
    "",
    "",
    "---",
    "Page: https://example.org/soul-land-map/#suotuo/suotuo-0042",
    "Version: 565548f (data 2026-11-21)",
    "Language: pt",
  ].join("\n"));
});

test("reportBody leaves out the version on a local server, and the date when it is missing", () => {
  const local = reportBody({ pageUrl: "http://localhost:8000/#nuoding", version: null, lang: "en", t });
  assert.doesNotMatch(local, /Version:/);
  assert.match(local, /^Page: http:\/\/localhost:8000\/#nuoding$/m);
  const noDate = reportBody({ pageUrl: PAGE, version: { ...VERSION, dataDate: null }, lang: "en", t });
  assert.match(noDate, /^Version: 565548f$/m);
});

test("reportUrl opens a new issue on the repo with the body in the query", () => {
  const url = new URL(reportUrl({ pageUrl: PAGE, version: VERSION, lang: "zh", t }));
  assert.equal(`${url.origin}${url.pathname}`, "https://github.com/gnbezerra/soul-land-map/issues/new");
  assert.deepEqual([...url.searchParams.keys()], ["body"]);
  assert.equal(url.searchParams.get("body"), reportBody({ pageUrl: PAGE, version: VERSION, lang: "zh", t }));
});
