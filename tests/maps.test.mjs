// Tests for js/maps.js. Run: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { selectableMaps } from "../js/maps.js";

const maps = { alpha: {}, beta: { draft: true }, gamma: { draft: false } };

test("selectableMaps leaves draft maps out, in maps.json order", () => {
  assert.deepEqual(selectableMaps(maps, "alpha"), ["alpha", "gamma"]);
});

test("selectableMaps lists a draft map while it is the current one", () => {
  assert.deepEqual(selectableMaps(maps, "beta"), ["alpha", "beta", "gamma"]);
});

test("selectableMaps with no draft maps lists them all", () => {
  assert.deepEqual(selectableMaps({ alpha: {}, gamma: {} }, "alpha"), ["alpha", "gamma"]);
});
