// Tests for js/geo.js. Run: node --test tests/
// Uses a made-up calibration, so recalibrating a real map never breaks them. Whether markers really land on
// the right spot of the image in real Leaflet is checked by tests/browser.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isCalibrated, gameToPixel, pixelToGame, pixelToLatLng, latLngToPixel } from "../js/geo.js";

// px = 2x + 100, py = -2y + 900: game Y grows upwards, pixel Y downwards.
const cal = { scaleX: 2, offsetX: 100, scaleY: -2, offsetY: 900 };

function close(actual, expected, label) {
  assert.equal(actual.length, expected.length, label);
  actual.forEach((v, i) => assert.ok(Math.abs(v - expected[i]) < 1e-9, `${label}: ${actual} vs ${expected}`));
}

test("isCalibrated needs all four numbers", () => {
  assert.equal(isCalibrated(cal), true);
  assert.equal(isCalibrated({ ...cal, offsetX: 0 }), true, "zero is a valid offset");
  assert.equal(isCalibrated(undefined), false);
  assert.equal(isCalibrated(null), false);
  assert.equal(isCalibrated({}), false);
  // data/maps.json uses null offsets for a map that is not calibrated yet.
  assert.equal(isCalibrated({ ...cal, offsetX: null, offsetY: null }), false);
  for (const key of Object.keys(cal)) {
    const { [key]: _, ...rest } = cal;
    assert.equal(isCalibrated(rest), false, `missing ${key}`);
    assert.equal(isCalibrated({ ...cal, [key]: String(cal[key]) }), false, `${key} as a string`);
  }
});

test("gameToPixel applies the linear calibration", () => {
  close(gameToPixel(cal, 0, 0), [100, 900], "origin");
  close(gameToPixel(cal, 10, 20), [120, 860], "point");
  close(gameToPixel(cal, 12.5, -3.25), [125, 906.5], "fractional and negative");
});

test("game Y up is pixel Y down", () => {
  const [, low] = gameToPixel(cal, 0, 10);
  const [, high] = gameToPixel(cal, 0, 20);
  assert.ok(high < low, "a higher game y is nearer the top of the image");
});

test("pixelToGame inverts gameToPixel", () => {
  close(pixelToGame(cal, 120, 860), [10, 20], "point");
  for (const [x, y] of [[0, 0], [10, 20], [-7.5, 333.25], [1e4, -1e4]]) {
    close(pixelToGame(cal, ...gameToPixel(cal, x, y)), [x, y], `round trip of ${x},${y}`);
  }
  // Also with the irrational-looking scale of a real map (25/7).
  const real = { scaleX: 25 / 7, offsetX: 428.5714285714, scaleY: -25 / 7, offsetY: 3657.142857142 };
  close(pixelToGame(real, ...gameToPixel(real, 510, 835)), [510, 835], "round trip with scale 25/7");
});

// A stand-in for a Leaflet map in CRS.Simple, whose default transformation is
// pixel = (lng * 2^zoom, -lat * 2^zoom). It also records the calls it gets.
function fakeMap() {
  const calls = [];
  return {
    calls,
    project(latlng, zoom) {
      calls.push(["project", latlng, zoom]);
      return { x: latlng.lng * 2 ** zoom, y: -latlng.lat * 2 ** zoom };
    },
    unproject([x, y], zoom) {
      calls.push(["unproject", [x, y], zoom]);
      return { lat: -y / 2 ** zoom, lng: x / 2 ** zoom };
    },
  };
}

test("pixelToLatLng unprojects the pixel at the native zoom", () => {
  const map = fakeMap();
  assert.deepEqual(pixelToLatLng(map, 4, 32, 48), { lat: -3, lng: 2 });
  assert.deepEqual(map.calls, [["unproject", [32, 48], 4]]);
  // The top-left corner of the image is (0, 0); the image lies in negative latitudes.
  assert.deepEqual(pixelToLatLng(map, 4, 0, 0), { lat: -0, lng: 0 });
  assert.ok(pixelToLatLng(map, 4, 4096, 4096).lat < 0);
});

test("latLngToPixel projects at the native zoom and returns [x, y]", () => {
  const map = fakeMap();
  assert.deepEqual(latLngToPixel(map, 4, { lat: -3, lng: 2 }), [32, 48]);
  assert.deepEqual(map.calls, [["project", { lat: -3, lng: 2 }, 4]]);
});

test("pixel -> LatLng -> pixel round trip, and game -> screen pixel -> game", () => {
  const map = fakeMap();
  for (const [px, py] of [[0, 0], [100, 900], [4096, 4096], [1234.5, 77.25]]) {
    close(latLngToPixel(map, 4, pixelToLatLng(map, 4, px, py)), [px, py], `pixel ${px},${py}`);
  }
  // What the coordinate readout does with a marker's position.
  const latlng = pixelToLatLng(map, 4, ...gameToPixel(cal, 10, 20));
  close(pixelToGame(cal, ...latLngToPixel(map, 4, latlng)), [10, 20], "readout of a marker");
});
