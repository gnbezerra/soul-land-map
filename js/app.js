import { isCalibrated, pixelToGame, pixelToLatLng, latLngToPixel } from "./geo.js";
import { fetchJson } from "./util.js";
import {
  loadSettings, saveSettings, loadProgress, saveProgress, loadTrials, saveTrials, buildBackup, parseBackup,
} from "./storage.js";
import { detectLang, loadI18n, loadLanguages } from "./i18n.js";
import { buildModel, applyProgress, countProgress } from "./model.js";
import { parseHash, mapHash, markerHash, markerLink } from "./links.js";
import { selectableMaps } from "./maps.js";
import { stageCounts, stagesDone, setTrialProgress, migrateFoundTrials } from "./trials.js";
import { createLayers } from "./layers.js";
import { createSidebar } from "./sidebar.js";
import { parseVersion } from "./version.js";
import { toggleSolo, endSolo, cleanSolo, applyDefaultHidden, recordShown } from "./filters.js";

const settings = loadSettings();
const maps = await fetchJson("data/maps.json");
// Deep links: #<map>, or #<map>/<marker id> to open a marker (js/links.js).
const link = parseHash(location.hash);
const mapId = link.mapId || settings.mapId || "nuoding";
const cfg = maps[mapId];
if (!cfg) throw new Error(`Unknown map: ${mapId}`);

const languages = await loadLanguages(fetchJson);
const lang = detectLang(languages, {
  query: location.search, saved: settings.lang, browser: navigator.languages ?? [navigator.language],
});
const [categories, entries, markers, i18n, version] = await Promise.all([
  fetchJson("data/categories.json"),
  fetchJson(`data/entries/${mapId}.json`, {}),
  fetchJson(`data/markers/${mapId}.json`, []),
  loadI18n(lang, mapId, fetchJson),
  // The published version (js/version.js); never worth failing the page over.
  fetchJson("version.json", null).then(parseVersion, () => null),
]);
const t = i18n.t;

document.documentElement.lang = lang;
document.title = t("ui.title");
document.getElementById("title").textContent = t("ui.title");

// Region selector. Switching reloads the page, which is enough for a handful of maps. Draft maps are
// left out unless they are the current one (js/maps.js).
const select = document.getElementById("map-select");
select.setAttribute("aria-label", t("ui.region"));
for (const id of selectableMaps(maps, mapId)) {
  select.append(new Option(t(`map.${id}`, id), id, false, id === mapId));
}
select.addEventListener("change", () => {
  saveSettings({ ...settings, mapId: select.value });
  location.hash = mapHash(select.value);
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
  // Without a ?lang= to drop, the address stays the same, and going to the same address with a hash
  // (#<map>, written by the deep links) only scrolls to it: the page must be reloaded instead.
  if (url.href === location.href) location.reload();
  else location.replace(url);
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
const maxBounds = bounds.pad(0.1);
map.setMaxBounds(maxBounds);
// A popup near the edge of the map needs room to pan into view, which the max bounds would undo
// at once. They are lifted while a popup is open (the popup then pans again) and restored on close.
map.on("popupopen", (e) => {
  map.setMaxBounds(null);
  e.popup.update();
});
map.on("popupclose", () => map.setMaxBounds(maxBounds));
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

  // Progress: the set of found marker ids, plus the stages done per Divine Trial.
  // Every change is saved at once.
  let found = loadProgress(mapId);
  let trials = loadTrials(mapId);
  let hideFound = settings.hideFound?.[mapId] === true;
  let storageWarned = false;
  // Backup messages count found markers and, when there are any, Divine Trial layers. Only markers that
  // exist in the data count (backups may carry stale ids).
  const progressOf = (ids, progress) => countProgress(markers, ids, progress);
  const progressMessage = (key, { markers: n, layers }) =>
    (layers ? i18n.tf(`${key}Layers`, { n, layers }) : i18n.tf(key, { n }));
  // Trial ids marked found before stage progress existed become complete trials (js/trials.js).
  const trialStages = stageCounts(markers);
  const migrateTrials = (foundIds, trialProgress) => migrateFoundTrials(foundIds, trialProgress, trialStages);

  function persist() {
    const savedFound = saveProgress(mapId, found);
    const savedTrials = saveTrials(mapId, trials);
    if ((savedFound && savedTrials) || storageWarned) return;
    storageWarned = true; // warn once, not on every click
    sidebar.showMessage(t("ui.storageError"), true);
  }

  function refreshProgress(markerId) {
    applyProgress(model, found, trials);
    layers.refreshFound(markerId);
    sidebar.refreshCounts();
  }

  function setFound(markerId, value) {
    if (value) found.add(markerId);
    else found.delete(markerId);
    persist();
    refreshProgress(markerId);
  }

  function setTrial(markerId, stagesDone) {
    setTrialProgress(trials, markerId, stagesDone);
    persist();
    refreshProgress(markerId);
  }

  const layers = createLayers({
    L, map, markers, entries, categories, calibration: cfg.calibration, nativeZoom: nz, i18n,
    isFound: (id) => found.has(id),
    onSetFound: setFound,
    trialDone: (id) => trials[id] ?? 0,
    onSetTrial: setTrial,
    linkFor: (id) => markerLink(location.href, mapId, id),
    // The address bar follows the open popup, without adding history entries (Back stays as it was).
    onPopupOpen: (id) => history.replaceState(null, "", markerHash(mapId, id)),
    onPopupClose: (id) => {
      if (parseHash(location.hash).markerId === id) history.replaceState(null, "", mapHash(mapId));
    },
    sheetHost: document.getElementById("map-wrap"),
  });
  const migrated = migrateTrials(found, trials);
  applyProgress(model, found, trials);
  layers.setHideFound(hideFound);
  // Hidden types are stored (not visible ones), so new types default to visible, except the
  // `defaultHidden` ones, hidden once and then remembered as seen (js/filters.js). "Only this" (solo) is
  // stored too, with the filter it replaced.
  let hidden = new Set(settings.hidden?.[mapId] ?? []);
  const allTypeIds = model.groups.flatMap((g) => g.types.map((x) => x.id));
  const defaults = applyDefaultHidden(hidden, settings.defaultsSeen?.[mapId] ?? [],
    allTypeIds.filter((id) => model.types.get(id).defaultHidden));
  hidden = defaults.hidden;
  const entryTypes = new Map([...model.types.values()].flatMap((x) => x.entries.map((e) => [e.id, x.id])));
  let solo = cleanSolo(settings.solo?.[mapId], allTypeIds, entryTypes);
  for (const type of model.types.keys()) layers.setVisible(type, !hidden.has(type));
  layers.setOnlyEntry(solo?.entry ?? null);

  // The unlocked types (categories.json `unlockedBy`) the player has had on the map at least once: the
  // sidebar stops suggesting them after that (js/filters.js unlockHints).
  const unlockedIds = allTypeIds.filter((id) => model.types.get(id).unlockedBy);
  let shown = new Set(settings.unlockedShown?.[mapId] ?? []);
  const noteShown = () => {
    const next = recordShown(shown, unlockedIds, (id) => !hidden.has(id));
    shown = next.shown;
    return next.changed;
  };

  function saveFilters() {
    noteShown();
    settings.hidden = { ...settings.hidden, [mapId]: [...hidden] };
    settings.defaultsSeen = { ...settings.defaultsSeen, [mapId]: [...defaults.seen] };
    settings.unlockedShown = { ...settings.unlockedShown, [mapId]: [...shown] };
    settings.solo = { ...settings.solo, [mapId]: solo };
    saveSettings(settings);
  }
  if (noteShown() || defaults.changed) saveFilters();

  // A checkbox (or anything that shows a type again) ends "only this": the filter on screen stays.
  function setTypes(typeIds, visible) {
    for (const type of typeIds) {
      if (visible) hidden.delete(type);
      else hidden.add(type);
      layers.setVisible(type, visible);
    }
    solo = null;
    layers.setOnlyEntry(null);
    saveFilters();
    sidebar.refresh();
  }

  // Whether "only this" on another entry keeps this one off the map; going to it then ends "only this",
  // as its type's checkbox would.
  const entryOf = new Map(markers.map((m) => [m.id, m.entry ?? null]));
  const hidesEntry = (entryId) => !!solo?.entry && solo.entry !== entryId;

  function applyFilter(next) {
    hidden = next.hidden;
    solo = next.solo;
    for (const type of model.types.keys()) layers.setVisible(type, !hidden.has(type));
    layers.setOnlyEntry(solo?.entry ?? null);
    saveFilters();
    sidebar.refresh();
  }

  function exportBackup() {
    // Other maps' progress is included so one file carries everything.
    const progress = {};
    const trialsByMap = {};
    for (const id of Object.keys(maps)) {
      progress[id] = id === mapId ? found : loadProgress(id);
      trialsByMap[id] = id === mapId ? trials : loadTrials(id);
    }
    const backup = buildBackup(progress, trialsByMap);
    const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `soul-land-map-progress-${backup.exportedAt.slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    sidebar.showMessage(progressMessage("ui.exported", progressOf(found, trials)));
  }

  async function importBackup(file) {
    const result = parseBackup(await file.text());
    if (result.error) {
      sidebar.showMessage(t(`ui.importError.${result.error}`), true);
      return;
    }
    // The backup's own trial ids are migrated first, so the confirmation counts them as layers.
    const incoming = new Set(result.progress[mapId] ?? []);
    const incomingTrials = { ...(result.trials[mapId] ?? {}) };
    migrateTrials(incoming, incomingTrials);
    const now = progressOf(found, trials);
    const next = progressOf(incoming, incomingTrials);
    const question = now.layers || next.layers
      ? i18n.tf("ui.importConfirmLayers", {
        current: now.markers, currentLayers: now.layers, incoming: next.markers, incomingLayers: next.layers,
      })
      : i18n.tf("ui.importConfirm", { current: now.markers, incoming: next.markers });
    if (!window.confirm(question)) return;
    // Other maps' trial ids in their found set are migrated when that map is opened.
    for (const [id, ids] of Object.entries(result.progress)) {
      if (id === mapId || !maps[id]) continue;
      saveProgress(id, ids);
      saveTrials(id, result.trials[id] ?? {});
    }
    found = incoming;
    trials = incomingTrials;
    persist();
    refreshProgress();
    sidebar.showMessage(progressMessage("ui.imported", progressOf(found, trials)));
  }

  const sidebar = createSidebar({
    container: document.getElementById("sidebar"),
    chipHost: document.getElementById("map-wrap"),
    model,
    milestones: cfg.exploration?.milestones ?? [],
    version,
    i18n,
    markers,
    isVisible: (type) => !hidden.has(type),
    wasShown: (type) => shown.has(type),
    onToggle: setTypes,
    getSolo: () => solo,
    // An entry shown alone is also framed, as clicking its name does.
    onSolo(typeIds, entryId = null) {
      applyFilter(toggleSolo({ hidden, solo }, typeIds, allTypeIds, entryId));
      if (solo?.entry) layers.focusEntry(solo.entry);
    },
    onSoloBack: () => applyFilter(endSolo(solo)),
    isHideFound: () => hideFound,
    onHideFound(value) {
      hideFound = value;
      settings.hideFound = { ...settings.hideFound, [mapId]: value };
      saveSettings(settings);
      layers.setHideFound(value);
    },
    onFocusEntry(entryId, typeId) {
      if (hidden.has(typeId) || hidesEntry(entryId)) setTypes([typeId], true);
      layers.focusEntry(entryId);
      closeDrawerIfNarrow();
    },
    onFocusMarker(markerId, typeId) {
      if (hidden.has(typeId) || hidesEntry(entryOf.get(markerId))) setTypes([typeId], true);
      closeDrawerIfNarrow();
      layers.focusMarker(markerId);
    },
    itemProgress(markerId) {
      const stages = trialStages.get(markerId);
      return stages ? [stagesDone(trials[markerId], stages), stages] : [found.has(markerId) ? 1 : 0, 1];
    },
    onExport: exportBackup,
    onImport: importBackup,
  });
  if (migrated) persist();

  // Opens the marker of a deep link, showing its type again if it was hidden. An unknown id (e.g. a
  // marker removed from the data) leaves just the map, and the address bar drops it.
  function openLinkedMarker(markerId) {
    const type = layers.typeOf(markerId);
    if (!type) {
      map.closePopup();
      history.replaceState(null, "", mapHash(mapId));
      return;
    }
    if (hidden.has(type) || hidesEntry(entryOf.get(markerId))) setTypes([type], true);
    layers.openMarker(markerId);
  }
  if (link.markerId) openLinkedMarker(link.markerId);
  // A hash typed or pasted into the address bar: another map reloads the page, a marker opens.
  window.addEventListener("hashchange", () => {
    const next = parseHash(location.hash);
    if (next.mapId && next.mapId !== mapId && maps[next.mapId]) location.reload();
    else if (next.markerId) openLinkedMarker(next.markerId);
    else map.closePopup();
  });
  map.on("click", () => {
    layers.highlight(null);
    closeDrawerIfNarrow();
  });
}
