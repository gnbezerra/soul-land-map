// Tests for js/portals.js. Run: node --test tests/
// Uses made-up maps and markers, so editing the real data never breaks them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { portalTitle, canGoTo, returnPortal } from "../js/portals.js";

function fakeI18n(ui) {
  const t = (key, fallback) => ui[key] ?? fallback ?? key;
  return { t, tf: (key, vars) => t(key).replace(/\{(\w+)\}/g, (m, name) => vars[name] ?? m) };
}

test("portalTitle: the destination's name, else its id", () => {
  const i18n = fakeI18n({ "popup.portalTo": "Portal to {map}", "map.east": "East Area" });
  assert.equal(portalTitle({ type: "portal", to: "east" }, i18n), "Portal to East Area");
  assert.equal(portalTitle({ type: "portal", to: "island" }, i18n), "Portal to island");
  const zh = fakeI18n({ "popup.portalTo": "前往{map}的传送门", "map.east": "东区" });
  assert.equal(portalTitle({ type: "portal", to: "east" }, zh), "前往东区的传送门");
});

test("canGoTo: maps on the site, not drafts nor missing ones", () => {
  const maps = { east: {}, draft: { draft: true } };
  assert.equal(canGoTo(maps, "east"), true);
  assert.equal(canGoTo(maps, "draft"), false);
  assert.equal(canGoTo(maps, "island"), false);
  assert.equal(canGoTo(maps, "toString"), false, "not an inherited property");
});

test("returnPortal: the one portal back, else null", () => {
  const markers = [
    { id: "e-0001", type: "portal", to: "west" },
    { id: "e-0002", type: "portal", to: "north" },
    { id: "e-0003", type: "portal", to: "north" },
    { id: "e-0004", type: "teleport", to: "south" },
  ];
  assert.equal(returnPortal(markers, "west"), "e-0001");
  assert.equal(returnPortal(markers, "north"), null, "two to choose from");
  assert.equal(returnPortal(markers, "south"), null, "not a portal");
  assert.equal(returnPortal([], "west"), null);
});
