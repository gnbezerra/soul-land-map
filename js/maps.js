// Which regions the top bar offers. Pure: no DOM, so it is easy to test. `maps` is data/maps.json.

// A map marked "draft" (tiles and calibration in, data still being collected) is left out of the region
// selector, so players do not land on an empty map, but its link (#<map>) still opens it. While it is the
// current map it is listed too, so the selector shows where the player is.
export function selectableMaps(maps, currentId) {
  return Object.keys(maps).filter((id) => !maps[id].draft || id === currentId);
}
