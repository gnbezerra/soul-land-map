import { gameToPixel, pixelToLatLng } from "./geo.js";

// Markers shrink when zoomed out so they do not pile up. Full size from the native zoom up;
// each level below it removes MARKER_SHRINK_PER_ZOOM, down to MARKER_MIN_SCALE.
const MARKER_SHRINK_PER_ZOOM = 0.25;
const MARKER_MIN_SCALE = 0.5;
// Below this scale the glyph is unreadable, so only the colored dot is shown.
const MARKER_TINY_SCALE = 0.65;

// Creates one Leaflet layer group per marker type, plus helpers to show/hide types
// and to focus and highlight all markers of an exploration entry.
export function createLayers({ L, map, markers, categories, calibration, nativeZoom, i18n }) {
  const layerByType = new Map();
  const container = map.getContainer();

  function updateScale() {
    const scale = Math.max(MARKER_MIN_SCALE, 1 - MARKER_SHRINK_PER_ZOOM * Math.max(0, nativeZoom - map.getZoom()));
    container.style.setProperty("--mk-scale", scale.toFixed(3));
    container.classList.toggle("mk-tiny", scale < MARKER_TINY_SCALE);
  }
  map.on("zoom zoomend", updateScale);
  updateScale();
  const recordsByEntry = new Map();
  let highlighted = null;

  function applyHighlight(record) {
    const on = record.entry != null && record.entry === highlighted;
    record.marker.getElement()?.classList.toggle("hl", on);
    record.marker.setZIndexOffset(on ? 1000 : 0);
  }

  function makeIcon(meta) {
    const dot = document.createElement("span");
    dot.className = "mk-dot";
    dot.style.setProperty("--c", meta.color);
    dot.textContent = meta.glyph;
    return L.divIcon({ html: dot, className: "mk", iconSize: [24, 24] });
  }

  function makeTooltip(m, point) {
    const title = m.entry
      ? i18n.entry(m.entry).name + (m.entryIndex ? ` #${m.entryIndex}` : "")
      : i18n.t(`type.${m.type}`);
    const box = document.createElement("div");
    const strong = document.createElement("strong");
    strong.textContent = title;
    const small = document.createElement("div");
    small.textContent = `${i18n.t(`type.${m.type}`)} · ${m.id} · ${point.x}, ${point.y}`;
    box.append(strong, small);
    return box;
  }

  for (const m of markers) {
    const meta = categories.types[m.type];
    if (!meta) {
      console.warn(`Skipping marker ${m.id}: unknown type '${m.type}'`);
      continue;
    }
    if (!layerByType.has(m.type)) layerByType.set(m.type, L.layerGroup());
    // Most markers have one position; some encounters have several `points`.
    const points = m.points ?? [{ x: m.x, y: m.y }];
    for (const p of points) {
      const [px, py] = gameToPixel(calibration, p.x, p.y);
      const marker = L.marker(pixelToLatLng(map, nativeZoom, px, py), { icon: makeIcon(meta) });
      marker.bindTooltip(makeTooltip(m, p));
      const record = { marker, entry: m.entry ?? null };
      marker.on("add", () => applyHighlight(record));
      layerByType.get(m.type).addLayer(marker);
      if (record.entry) {
        if (!recordsByEntry.has(record.entry)) recordsByEntry.set(record.entry, []);
        recordsByEntry.get(record.entry).push(record);
      }
    }
  }

  return {
    setVisible(type, visible) {
      const layer = layerByType.get(type);
      if (!layer) return;
      if (visible) layer.addTo(map);
      else map.removeLayer(layer);
    },
    highlight(entryId) {
      highlighted = entryId;
      for (const records of recordsByEntry.values()) records.forEach(applyHighlight);
    },
    // Frames all markers of an entry and highlights them. Returns false if it has none.
    focusEntry(entryId) {
      const records = recordsByEntry.get(entryId);
      if (!records?.length) return false;
      const bounds = L.latLngBounds(records.map((r) => r.marker.getLatLng()));
      map.fitBounds(bounds.pad(0.3), { maxZoom: nativeZoom + 1 });
      this.highlight(entryId);
      return true;
    },
  };
}
