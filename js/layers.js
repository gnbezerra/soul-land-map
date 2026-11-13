import { gameToPixel, pixelToLatLng } from "./geo.js";

// Markers shrink when zoomed out so they do not pile up. Full size from the native zoom up;
// each level below it removes MARKER_SHRINK_PER_ZOOM, down to MARKER_MIN_SCALE.
const MARKER_SHRINK_PER_ZOOM = 0.25;
const MARKER_MIN_SCALE = 0.5;
// Below this scale the glyph is unreadable, so only the colored dot is shown.
const MARKER_TINY_SCALE = 0.65;

// Extra marker fields shown in the popup when present (other types will fill these in).
const POPUP_FIELDS = ["subtype", "players", "contract", "species", "seed", "requiresSeed", "to"];

// Creates one Leaflet layer group per marker type and handles marker state:
// visibility per type, highlight, found (faded) and "hide found".
//   isFound(markerId) -> boolean          onSetFound(markerId, found)
export function createLayers({ L, map, markers, categories, calibration, nativeZoom, i18n, isFound, onSetFound }) {
  const layerByType = new Map();
  const recordsByEntry = new Map();
  const recordsById = new Map();
  const container = map.getContainer();
  let highlighted = null;
  let hideFound = false;
  // Hover tooltips only make sense with a mouse; on touch screens a tap opens the popup.
  const canHover = window.matchMedia("(hover: hover)").matches;

  function updateScale() {
    const scale = Math.max(MARKER_MIN_SCALE, 1 - MARKER_SHRINK_PER_ZOOM * Math.max(0, nativeZoom - map.getZoom()));
    container.style.setProperty("--mk-scale", scale.toFixed(3));
    container.classList.toggle("mk-tiny", scale < MARKER_TINY_SCALE);
  }
  map.on("zoom zoomend", updateScale);
  updateScale();

  // Applies highlight, found and "hide found" to one marker.
  function applyState(record) {
    const el = record.marker.getElement();
    const found = isFound(record.id);
    if (el) {
      el.classList.toggle("hl", record.entry != null && record.entry === highlighted);
      el.classList.toggle("found", found);
    }
    record.marker.setZIndexOffset(record.entry != null && record.entry === highlighted ? 1000 : found ? -500 : 0);
    const shouldShow = !(hideFound && found);
    if (shouldShow && !record.group.hasLayer(record.marker)) record.group.addLayer(record.marker);
    else if (!shouldShow && record.group.hasLayer(record.marker)) record.group.removeLayer(record.marker);
  }

  function makeIcon(meta) {
    const dot = document.createElement("span");
    dot.className = "mk-dot";
    dot.style.setProperty("--c", meta.color);
    dot.textContent = meta.glyph;
    return L.divIcon({ html: dot, className: "mk", iconSize: [24, 24] });
  }

  function titleOf(m) {
    if (m.entry) return i18n.entry(m.entry).name + (m.entryIndex ? ` #${m.entryIndex}` : "");
    return i18n.markerName(m.id) || i18n.t(`type.${m.type}`);
  }

  function makeTooltip(m, point) {
    const box = document.createElement("div");
    const strong = document.createElement("strong");
    strong.textContent = titleOf(m);
    const small = document.createElement("div");
    small.textContent = `${i18n.t(`type.${m.type}`)} · ${m.id} · ${point.x}, ${point.y}`;
    box.append(strong, small);
    return box;
  }

  // Popup content is built on every open, so it always reflects the current state.
  function makePopup(m, point) {
    const root = document.createElement("div");
    root.className = "mk-popup";
    const title = document.createElement("strong");
    title.textContent = titleOf(m);
    const kind = document.createElement("div");
    kind.className = "muted";
    kind.textContent = i18n.t(`type.${m.type}`);
    root.append(title, kind);

    const description = m.entry ? i18n.entry(m.entry).description : "";
    if (description) {
      const p = document.createElement("p");
      p.className = "desc";
      p.textContent = description;
      root.append(p);
    }

    const fields = POPUP_FIELDS.filter((f) => m[f] != null && m[f] !== "");
    if (fields.length) {
      const dl = document.createElement("dl");
      for (const f of fields) {
        const dt = document.createElement("dt");
        dt.textContent = i18n.t(`field.${f}`, f);
        const dd = document.createElement("dd");
        dd.textContent = String(m[f]);
        dl.append(dt, dd);
      }
      root.append(dl);
    }

    const button = document.createElement("button");
    button.type = "button";
    button.className = "found-btn";
    const sync = () => {
      const found = isFound(m.id);
      button.textContent = i18n.t(found ? "ui.unmarkFound" : "ui.markFound");
      button.classList.toggle("is-found", found);
      button.setAttribute("aria-pressed", String(found));
    };
    button.addEventListener("click", () => {
      onSetFound(m.id, !isFound(m.id));
      sync();
    });
    sync();

    const coords = document.createElement("div");
    coords.className = "muted small";
    coords.textContent = `${m.id} · X ${point.x}, Y ${point.y}`;
    root.append(button, coords);
    return root;
  }

  for (const m of markers) {
    const meta = categories.types[m.type];
    if (!meta) {
      console.warn(`Skipping marker ${m.id}: unknown type '${m.type}'`);
      continue;
    }
    if (!layerByType.has(m.type)) layerByType.set(m.type, L.layerGroup());
    const group = layerByType.get(m.type);
    // Most markers have one position; some encounters have several `points`.
    const points = m.points ?? [{ x: m.x, y: m.y }];
    for (const p of points) {
      const [px, py] = gameToPixel(calibration, p.x, p.y);
      const marker = L.marker(pixelToLatLng(map, nativeZoom, px, py), { icon: makeIcon(meta) });
      if (canHover) marker.bindTooltip(makeTooltip(m, p));
      marker.bindPopup(() => makePopup(m, p), { className: "mk-popup-wrap", closeButton: true, autoPanPadding: [24, 24] });
      const record = { id: m.id, marker, group, entry: m.entry ?? null };
      marker.on("add", () => applyState(record));
      group.addLayer(marker);
      if (!recordsById.has(m.id)) recordsById.set(m.id, []);
      recordsById.get(m.id).push(record);
      if (record.entry) {
        if (!recordsByEntry.has(record.entry)) recordsByEntry.set(record.entry, []);
        recordsByEntry.get(record.entry).push(record);
      }
    }
  }

  const allRecords = () => [...recordsById.values()].flat();

  return {
    setVisible(type, visible) {
      const layer = layerByType.get(type);
      if (!layer) return;
      if (visible) layer.addTo(map);
      else map.removeLayer(layer);
    },
    // Re-applies the found state: of one marker id, or of all markers when omitted.
    refreshFound(markerId) {
      for (const record of markerId ? recordsById.get(markerId) ?? [] : allRecords()) applyState(record);
    },
    setHideFound(value) {
      hideFound = value;
      allRecords().forEach(applyState);
    },
    highlight(entryId) {
      highlighted = entryId;
      allRecords().forEach(applyState);
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
