// Portals: the whirlpools that lead to another map (SPEC 4.2, type `portal`, field `to`). Pure: no DOM, so it
// is easy to test. `i18n` is the object from js/i18n.js loadI18n; `maps` is data/maps.json.

// "Portal to Suotuo City Area": the destination's name, else its id when the site has no name for it.
export function portalTitle(m, i18n) {
  return i18n.tf("popup.portalTo", { map: i18n.t(`map.${m.to}`, m.to) });
}

// Whether the site can take the player there: the map exists and is not a draft (js/maps.js), so the popup
// offers "Go to this map".
export function canGoTo(maps, mapId) {
  return Object.hasOwn(maps, mapId) && !maps[mapId].draft;
}

// The id of the portal that leads back to `fromMapId` among `markers` (the destination map's), where the
// player comes out; null when there is none, or more than one to choose from.
export function returnPortal(markers, fromMapId) {
  const back = markers.filter((m) => m.type === "portal" && m.to === fromMapId);
  return back.length === 1 ? back[0].id : null;
}
