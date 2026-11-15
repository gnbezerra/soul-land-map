// Tests for js/links.js. Run: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHash, mapHash, markerHash, markerLink } from "../js/links.js";

test("parseHash reads #map and #map/marker", () => {
  assert.deepEqual(parseHash("#nuoding"), { mapId: "nuoding", markerId: null });
  assert.deepEqual(parseHash("#nuoding/nuoding-0142"), { mapId: "nuoding", markerId: "nuoding-0142" });
  assert.deepEqual(parseHash("nuoding/nuoding-0142"), { mapId: "nuoding", markerId: "nuoding-0142" }, "without #");
  assert.deepEqual(parseHash("#nuoding/"), { mapId: "nuoding", markerId: null });
});

test("parseHash: no hash, or nothing usable", () => {
  for (const hash of ["", "#", undefined, null]) assert.deepEqual(parseHash(hash), { mapId: null, markerId: null }, String(hash));
  assert.deepEqual(parseHash("#/nuoding-0142"), { mapId: null, markerId: "nuoding-0142" });
});

test("parseHash decodes escapes and survives malformed ones", () => {
  assert.deepEqual(parseHash("#nuoding%2Fnuoding-0142"), { mapId: "nuoding", markerId: "nuoding-0142" });
  assert.deepEqual(parseHash("#nuo%E0ding"), { mapId: "nuo%E0ding", markerId: null });
});

test("hashes round-trip through parseHash", () => {
  assert.equal(mapHash("nuoding"), "#nuoding");
  assert.equal(markerHash("nuoding", "nuoding-0142"), "#nuoding/nuoding-0142");
  assert.deepEqual(parseHash(markerHash("nuoding", "nuoding-0142")), { mapId: "nuoding", markerId: "nuoding-0142" });
});

test("markerLink keeps the page's path, and drops its query and hash", () => {
  assert.equal(markerLink("https://gnbezerra.github.io/soul-land-map/?lang=pt#nuoding", "nuoding", "nuoding-0142"),
    "https://gnbezerra.github.io/soul-land-map/#nuoding/nuoding-0142");
  assert.equal(markerLink("http://localhost:8000/", "nuoding", "nuoding-0001"), "http://localhost:8000/#nuoding/nuoding-0001");
  assert.equal(markerLink("http://localhost:8000/index.html#suotuo/suotuo-0003", "nuoding", "nuoding-0001"),
    "http://localhost:8000/index.html#nuoding/nuoding-0001");
});
