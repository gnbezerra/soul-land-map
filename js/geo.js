// Conversions between game coordinates, image pixels and Leaflet LatLng (CRS.Simple).
// Pixels: origin at the top-left corner of the original image, Y pointing down.
// Game Y grows upwards, which is why scaleY is negative in data/maps.json.

export function isCalibrated(c) {
  return !!c && ["scaleX", "offsetX", "scaleY", "offsetY"].every((k) => typeof c[k] === "number");
}

export function gameToPixel(c, gx, gy) {
  return [c.scaleX * gx + c.offsetX, c.scaleY * gy + c.offsetY];
}

export function pixelToGame(c, px, py) {
  return [(px - c.offsetX) / c.scaleX, (py - c.offsetY) / c.scaleY];
}

// In CRS.Simple, LatLng has lat pointing up, but the default transformation does
// pixel_y = -lat * 2^zoom (and pixel_x = lng * 2^zoom). So project/unproject at the
// native zoom are equivalent to image pixels, with the origin (lat 0, lng 0) at the
// top-left corner and the image lying in negative latitudes.
export function pixelToLatLng(map, nativeZoom, px, py) {
  return map.unproject([px, py], nativeZoom);
}

export function latLngToPixel(map, nativeZoom, latlng) {
  const p = map.project(latlng, nativeZoom);
  return [p.x, p.y];
}
