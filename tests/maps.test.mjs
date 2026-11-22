// Tests for js/maps.js. Run: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { openingView, selectableMaps } from "../js/maps.js";

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

const image = { width: 2048, height: 2048 };

test("openingView is the maps.json view as image corners", () => {
  assert.deepEqual(openingView({ image, view: { x: 60, y: 80, width: 660, height: 390 } }),
    { x0: 60, y0: 80, x1: 720, y1: 470 });
});

test("openingView clips the view to the image", () => {
  assert.deepEqual(openingView({ image, view: { x: -10, y: 2000, width: 100, height: 100 } }),
    { x0: 0, y0: 2000, x1: 90, y1: 2048 });
});

test("openingView is null without a view, or with one that is broken or outside the image", () => {
  assert.equal(openingView({ image }), null);
  assert.equal(openingView({ image, view: { x: 0, y: 0, width: 100 } }), null);
  assert.equal(openingView({ image, view: { x: 0, y: 0, width: 0, height: 100 } }), null);
  assert.equal(openingView({ image, view: { x: 3000, y: 0, width: 100, height: 100 } }), null);
  assert.equal(openingView({ view: { x: 0, y: 0, width: 100, height: 100 } }), null);
  assert.equal(openingView(undefined), null);
});
