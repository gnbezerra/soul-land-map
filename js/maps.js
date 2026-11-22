// Which regions the top bar offers. Pure: no DOM, so it is easy to test. `maps` is data/maps.json.

// A map marked "draft" (tiles and calibration in, data still being collected) is left out of the region
// selector, so players do not land on an empty map, but its link (#<map>) still opens it. While it is the
// current map it is listed too, so the selector shows where the player is.
export function selectableMaps(maps, currentId) {
  return Object.keys(maps).filter((id) => !maps[id].draft || id === currentId);
}

// The image rectangle a map opens on (maps.json "view", in image pixels), as { x0, y0, x1, y1 } clipped to
// the image; null when the map has none, or a broken one, and opens on the whole image. Meant for a region
// whose points fill only part of its image (Xing Dou Great Forest: the rest is fog). Zooming out still shows
// the whole image.
export function openingView(cfg) {
  const v = cfg?.view;
  const { width, height } = cfg?.image ?? {};
  if (!v || ![v.x, v.y, v.width, v.height, width, height].every(Number.isFinite)) return null;
  const x0 = Math.max(0, v.x), y0 = Math.max(0, v.y);
  const x1 = Math.min(width, v.x + v.width), y1 = Math.min(height, v.y + v.height);
  return x1 > x0 && y1 > y0 ? { x0, y0, x1, y1 } : null;
}
