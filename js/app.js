import { isCalibrated, pixelToGame, pixelToLatLng, latLngToPixel } from "./geo.js";
import { fetchJson } from "./util.js";
import { loadSettings, saveSettings, loadProgress, saveProgress, buildBackup, parseBackup } from "./storage.js";
import { detectLang, loadI18n, loadLanguages } from "./i18n.js";
import { buildModel, applyProgress } from "./model.js";
import { createLayers } from "./layers.js";
import { createSidebar } from "./sidebar.js";

const settings = loadSettings();
const maps = await fetchJson("data/maps.json");
const mapId = location.hash.slice(1).split("/")[0] || settings.mapId || "nuoding";
const cfg = maps[mapId];
if (!cfg) throw new Error(`Unknown map: ${mapId}`);

const languages = await loadLanguages();
const lang = detectLang(settings, languages);
const [categories, entries, markers, i18n] = await Promise.all([
  fetchJson("data/categories.json"),
  fetchJson(`data/entries/${mapId}.json`, {}),
  fetchJson(`data/markers/${mapId}.json`, []),
  loadI18n(lang, mapId),
]);
const t = i18n.t;

document.documentElement.lang = lang;
document.title = t("ui.title");
document.getElementById("title").textContent = t("ui.title");

// Region selector. Switching reloads the page, which is enough while there is one map.
const select = document.getElementById("map-select");
select.setAttribute("aria-label", t("ui.region"));
for (const id of Object.keys(maps)) {
  select.append(new Option(t(`map.${id}`, id), id, false, id === mapId));
}
select.addEventListener("change", () => {
  saveSettings({ ...settings, mapId: select.value });
  location.hash = select.value;
  location.reload();
});

// Language selector: shows the codes to keep the top bar narrow; full names are tooltips.
// The choice is saved; an explicit ?lang= in the URL would override it, so it is dropped.
const langSelect = document.getElementById("lang-select");
langSelect.setAttribute("aria-label", t("ui.language"));
for (const [code, name] of Object.entries(languages)) {
  const option = new Option(code.toUpperCase(), code, false, code === lang);
  option.title = name;
  langSelect.append(option);
}
langSelect.title = languages[lang];
langSelect.addEventListener("change", () => {
  saveSettings({ ...settings, lang: langSelect.value });
  const url = new URL(location.href);
  url.searchParams.delete("lang");
  location.replace(url);
});

// --- Map -----------------------------------------------------------------------------
const { width, height } = cfg.image;
const tiles = cfg.tiles;
const nz = tiles.maxNativeZoom;

const map = L.map("map", {
  crs: L.CRS.Simple,
  minZoom: 0,
  maxZoom: tiles.maxZoom,
  // Fractional zoom lets the whole map fill the window exactly; the wheel step is
  // gentler than Leaflet's default so it does not jump a whole level per notch.
  zoomSnap: 0,
  zoomDelta: 0.5,
  wheelPxPerZoomLevel: 120,
  attributionControl: false,
});
const bounds = L.latLngBounds(pixelToLatLng(map, nz, 0, height), pixelToLatLng(map, nz, width, 0));
L.tileLayer(`tiles/${mapId}/{z}/{x}/{y}.webp`, {
  tileSize: tiles.tileSize,
  minZoom: 0,
  maxZoom: tiles.maxZoom,
  maxNativeZoom: nz,
  noWrap: true,
  bounds,
}).addTo(map);
// The +/- buttons and keyboard keys land on multiples of zoomDelta (e.g. 2, 2.5, 3...) instead
// of adding it to the fractional "fit" zoom, so whole levels hit the crisp native tiles.
// The mouse wheel is not affected and keeps its finer, continuous steps.
function snappedZoom(zoom, step, direction) {
  const eps = 1e-6;
  const k = direction > 0 ? Math.floor(zoom / step + eps) + 1 : Math.ceil(zoom / step - eps) - 1;
  return k * step;
}
for (const [name, direction] of [["zoomIn", 1], ["zoomOut", -1]]) {
  map[name] = function (delta, options) {
    const step = this.options.zoomDelta;
    const steps = Math.max(1, Math.round((delta || step) / step)); // Shift multiplies the delta
    const target = snappedZoom(this.getZoom(), step, direction) + direction * (steps - 1) * step;
    return this.setZoom(target, options);
  };
}

// The whole map fills the window; zooming out further would only show empty space.
function fitWholeMap() {
  map.invalidateSize();
  const zoom = map.getBoundsZoom(bounds, false);
  map.setMinZoom(zoom);
  map.fitBounds(bounds, { animate: false });
}
fitWholeMap();
map.setMaxBounds(bounds.pad(0.1));
window.addEventListener("resize", fitWholeMapIfMinimal);

// Coordinate readout: validates the calibration and helps debugging data.
const readout = document.getElementById("readout");
const pin = document.getElementById("pin");
readout.textContent = t("ui.hover");
const calibrated = isCalibrated(cfg.calibration);

function describe(latlng) {
  const [px, py] = latLngToPixel(map, nz, latlng);
  const pixels = `px ${px.toFixed(0)}, ${py.toFixed(0)}`;
  if (!calibrated) return pixels;
  const [gx, gy] = pixelToGame(cfg.calibration, px, py);
  return `X ${gx.toFixed(1)} · Y ${gy.toFixed(1)} · ${pixels}`;
}
map.on("mousemove", (e) => { readout.textContent = describe(e.latlng); });
map.on("click", (e) => {
  pin.textContent = describe(e.latlng);
  console.log(pin.textContent);
});

// After the sidebar opens or closes, keep the minimum zoom valid without moving the view
// when the user is already zoomed in.
function fitWholeMapIfMinimal() {
  const wasFitted = map.getZoom() <= map.getMinZoom() + 0.01;
  map.invalidateSize();
  map.setMinZoom(map.getBoundsZoom(bounds, false));
  if (wasFitted) map.fitBounds(bounds, { animate: false });
}

// --- Sidebar toggle ---------------------------------------------------------------------
const toggle = document.getElementById("sidebar-toggle");
function updateToggleLabel() {
  const hidden = document.body.classList.contains("sidebar-hidden");
  toggle.textContent = t(hidden ? "ui.showSidebar" : "ui.hideSidebar");
  toggle.setAttribute("aria-expanded", String(!hidden));
}
toggle.addEventListener("click", () => {
  document.body.classList.toggle("sidebar-hidden");
  updateToggleLabel();
  fitWholeMapIfMinimal();
});
// On small screens the sidebar is a drawer: start closed and close it after the user
// picks something, so the map is visible again.
const narrow = window.matchMedia("(max-width: 700px)");
if (narrow.matches) document.body.classList.add("sidebar-hidden");
updateToggleLabel();
function closeDrawerIfNarrow() {
  if (!narrow.matches || document.body.classList.contains("sidebar-hidden")) return;
  document.body.classList.add("sidebar-hidden");
  updateToggleLabel();
}

// --- Markers and filters ------------------------------------------------------------------
if (!calibrated) {
  pin.textContent = t("ui.noCalibration");
} else {
  const model = buildModel(categories, entries, markers);
  for (const type of model.unknownTypes) console.warn(`Type '${type}' is missing from categories.json`);

  // Progress: the set of found marker ids. Every change is saved at once.
  let found = loadProgress(mapId);
  let hideFound = settings.hideFound?.[mapId] === true;
  let storageWarned = false;
  // Counts in messages only include markers that exist in the data (backups may carry stale ids).
  const knownIds = new Set(markers.map((m) => m.id));
  const countKnown = (ids) => [...ids].filter((id) => knownIds.has(id)).length;

  function persistProgress() {
    if (saveProgress(mapId, found) || storageWarned) return;
    storageWarned = true; // warn once, not on every click
    sidebar.showMessage(t("ui.storageError"), true);
  }

  function setFound(markerId, value) {
    if (value) found.add(markerId);
    else found.delete(markerId);
    persistProgress();
    applyProgress(model, found);
    layers.refreshFound(markerId);
    sidebar.refreshCounts();
  }

  const layers = createLayers({
    L, map, markers, categories, calibration: cfg.calibration, nativeZoom: nz, i18n,
    isFound: (id) => found.has(id),
    onSetFound: setFound,
  });
  applyProgress(model, found);
  layers.setHideFound(hideFound);
  // Hidden types are stored (not visible ones), so new types default to visible.
  const hidden = new Set(settings.hidden?.[mapId] ?? []);
  for (const type of model.types.keys()) layers.setVisible(type, !hidden.has(type));

  function setTypes(typeIds, visible) {
    for (const type of typeIds) {
      if (visible) hidden.delete(type);
      else hidden.add(type);
      layers.setVisible(type, visible);
    }
    settings.hidden = { ...settings.hidden, [mapId]: [...hidden] };
    saveSettings(settings);
    sidebar.refresh();
  }

  function exportBackup() {
    // Other maps' progress is included so one file carries everything.
    const progress = {};
    for (const id of Object.keys(maps)) progress[id] = id === mapId ? found : loadProgress(id);
    const backup = buildBackup(progress);
    const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `soul-land-map-progress-${backup.exportedAt.slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    sidebar.showMessage(i18n.tf("ui.exported", { n: countKnown(found) }));
  }

  async function importBackup(file) {
    const result = parseBackup(await file.text());
    if (result.error) {
      sidebar.showMessage(t(`ui.importError.${result.error}`), true);
      return;
    }
    const incoming = result.progress[mapId] ?? new Set();
    if (!window.confirm(i18n.tf("ui.importConfirm", { current: countKnown(found), incoming: countKnown(incoming) }))) return;
    for (const [id, ids] of Object.entries(result.progress)) {
      if (id !== mapId && maps[id]) saveProgress(id, ids);
    }
    found = new Set(incoming);
    persistProgress();
    applyProgress(model, found);
    layers.refreshFound();
    sidebar.refreshCounts();
    sidebar.showMessage(i18n.tf("ui.imported", { n: countKnown(found) }));
  }

  const sidebar = createSidebar({
    container: document.getElementById("sidebar"),
    model,
    i18n,
    isVisible: (type) => !hidden.has(type),
    onToggle: setTypes,
    isHideFound: () => hideFound,
    onHideFound(value) {
      hideFound = value;
      settings.hideFound = { ...settings.hideFound, [mapId]: value };
      saveSettings(settings);
      layers.setHideFound(value);
    },
    onFocusEntry(entryId, typeId) {
      if (hidden.has(typeId)) setTypes([typeId], true);
      layers.focusEntry(entryId);
      closeDrawerIfNarrow();
    },
    onExport: exportBackup,
    onImport: importBackup,
  });
  map.on("click", () => {
    layers.highlight(null);
    closeDrawerIfNarrow();
  });
}
