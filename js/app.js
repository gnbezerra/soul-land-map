import { isCalibrated, gameToPixel, pixelToGame, pixelToLatLng, latLngToPixel } from "./geo.js";

const mapId = location.hash.slice(1).split("/")[0] || "nuoding";
const maps = await (await fetch("data/maps.json")).json();
const cfg = maps[mapId];
if (!cfg) throw new Error(`Unknown map: ${mapId}`);

const { width, height } = cfg.image;
const t = cfg.tiles;
const nz = t.maxNativeZoom;

const map = L.map("map", {
  crs: L.CRS.Simple,
  minZoom: 0,
  maxZoom: t.maxZoom,
  zoomSnap: 0.5,
  zoomDelta: 0.5,
  attributionControl: false,
});

const bounds = L.latLngBounds(
  pixelToLatLng(map, nz, 0, height),
  pixelToLatLng(map, nz, width, 0)
);

L.tileLayer(`tiles/${mapId}/{z}/{x}/{y}.webp`, {
  tileSize: t.tileSize,
  minZoom: 0,
  maxZoom: t.maxZoom,
  maxNativeZoom: nz,
  noWrap: true,
  bounds,
}).addTo(map);

map.fitBounds(bounds);
map.setMaxBounds(bounds.pad(0.2));

// Coordinate readout: validates the calibration and helps debugging data.
const readout = document.getElementById("readout");
const pin = document.getElementById("pin");
const calibrated = isCalibrated(cfg.calibration);

function describe(latlng) {
  const [px, py] = latLngToPixel(map, nz, latlng);
  const pixels = `px ${px.toFixed(0)}, ${py.toFixed(0)}`;
  if (!calibrated) return `no calibration · ${pixels}`;
  const [gx, gy] = pixelToGame(cfg.calibration, px, py);
  return `X ${gx.toFixed(1)} · Y ${gy.toFixed(1)} · ${pixels}`;
}

map.on("mousemove", (e) => { readout.textContent = describe(e.latlng); });
map.on("click", (e) => {
  pin.textContent = `click: ${describe(e.latlng)}`;
  console.log(pin.textContent);
});

// Test markers (game coordinates). Without a complete calibration there is nothing to draw.
if (calibrated) {
  const res = await fetch(`data/markers/${mapId}.json`);
  const markers = res.ok ? await res.json() : [];
  for (const m of markers) {
    const [px, py] = gameToPixel(cfg.calibration, m.x, m.y);
    L.circleMarker(pixelToLatLng(map, nz, px, py), {
      radius: 6, color: "#fff", weight: 2, fillColor: "#f5a524", fillOpacity: 1,
    }).bindTooltip(`${m.id} (${m.x}, ${m.y})`).addTo(map);
  }
} else {
  pin.textContent = "Incomplete calibration in data/maps.json: fill in offsetX and offsetY.";
}
