import { gameToPixel, pixelToLatLng } from "./geo.js";
import {
  stageCount, stagesDone, isTrialComplete, isTrialStarted, nextTrialProgress, markAllProgress,
} from "./trials.js";

// Markers shrink when zoomed out so they do not pile up. Full size from the native zoom up;
// each level below it removes MARKER_SHRINK_PER_ZOOM, down to MARKER_MIN_SCALE.
const MARKER_SHRINK_PER_ZOOM = 0.25;
const MARKER_MIN_SCALE = 0.5;
// Below this scale the glyph is unreadable, so only the colored dot is shown.
const MARKER_TINY_SCALE = 0.65;

// Extra marker fields shown in the popup when present (other types will fill these in).
// A Divine Trial shows its subtype in the type line instead.
const POPUP_FIELDS = ["subtype", "players", "contract", "species", "seed", "requiresSeed", "to"];

// Creates one Leaflet layer group per marker type and handles marker state:
// visibility per type, highlight, found (faded) and "hide found".
//   isFound(markerId) -> boolean          onSetFound(markerId, found)
//   trialDone(markerId) -> stages done    onSetTrial(markerId, stagesDone)   (Divine Trials)
// A Divine Trial counts as found once all its stages are done.
export function createLayers({ L, map, markers, categories, calibration, nativeZoom, i18n, isFound, onSetFound, trialDone, onSetTrial }) {
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

  const stagesOf = stageCount;
  const doneOf = (m) => stagesDone(trialDone(m.id), stagesOf(m));
  const isComplete = (m) => (stagesOf(m) ? isTrialComplete(doneOf(m), stagesOf(m)) : isFound(m.id));

  // Applies highlight, found, the trial badge and "hide found" to one marker.
  function applyState(record) {
    const el = record.marker.getElement();
    const found = isComplete(record.m);
    if (el) {
      el.classList.toggle("hl", record.entry != null && record.entry === highlighted);
      el.classList.toggle("found", found);
      if (stagesOf(record.m)) {
        let badge = el.querySelector(".mk-badge");
        if (!badge) {
          badge = document.createElement("span");
          badge.className = "mk-badge";
          el.append(badge);
        }
        const done = doneOf(record.m);
        badge.textContent = `${done}/${stagesOf(record.m)}`;
        badge.hidden = !isTrialStarted(done, stagesOf(record.m));
      }
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

  // Own name (trials, books, teleports, viewpoints) first, then the entry name, then the type.
  function titleOf(m) {
    const own = i18n.marker(m.id).name;
    if (own) return own;
    if (m.entry) return i18n.entry(m.entry).name + (m.entryIndex ? ` #${m.entryIndex}` : "");
    return i18n.t(`type.${m.type}`);
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
    if (stagesOf(m) && m.subtype) kind.textContent += ` · ${i18n.t(`trial.${m.subtype}`, m.subtype)}`;
    root.append(title, kind);

    const description = m.entry ? i18n.entry(m.entry).description : "";
    if (description) {
      const p = document.createElement("p");
      p.className = "desc";
      p.textContent = description;
      root.append(p);
    }
    // Own note (e.g. "inside the cave under the plains"); howto is not shown yet.
    const note = i18n.marker(m.id).note;
    if (note) {
      const p = document.createElement("p");
      p.className = "note";
      p.textContent = note;
      root.append(p);
    }

    const fields = POPUP_FIELDS.filter((f) => m[f] != null && m[f] !== "" && !(f === "subtype" && stagesOf(m)));
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

    const coords = document.createElement("div");
    coords.className = "muted small";
    coords.textContent = `${m.id} · X ${point.x}, Y ${point.y}`;
    if (stagesOf(m)) {
      root.append(...makeTrialSection(m), coords);
      return root;
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
    root.append(button, coords);
    return root;
  }

  // Divine Trial: progress, stage list and a "mark all" button (rules in js/trials.js).
  // The elements are built once and updated in place, so keyboard focus stays where it is.
  function makeTrialSection(m) {
    const total = stagesOf(m);
    const combat = m.subtype === "combat";
    const numbers = new Intl.NumberFormat(i18n.lang);
    const el = (tag, className, text) => {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text != null) node.textContent = text;
      return node;
    };
    const set = (n) => {
      onSetTrial(m.id, n);
      sync();
    };

    const doneText = el("b");
    const head = el("div", "trial-head");
    head.append(el("span", "muted", i18n.t("trial.progress")), doneText);
    const barFill = el("i");
    const bar = el("div", "trial-bar");
    bar.append(barFill);

    const columns = el("div", `trial-cols${combat ? " combat" : ""}`);
    columns.setAttribute("aria-hidden", "true");
    columns.append(el("span"), el("span", "", "#"), el("span", "", i18n.t("trial.difficulty")));
    if (combat) {
      columns.append(el("span", "", i18n.t("trial.level")), el("span", "num", i18n.t("trial.rating")));
      columns.children[3].title = i18n.t("trial.levelHint");
      columns.children[4].title = i18n.t("trial.ratingHint");
    }

    const list = el("ol", "trial-stages");
    const rows = m.stages.map((stage, i) => {
      const k = i + 1;
      const row = el("button", `trial-stage${combat ? " combat" : ""}`);
      row.type = "button";
      const check = el("span", "check");
      const stars = el("span", "stars", "✦".repeat(stage.stars));
      stars.title = i18n.tf("trial.stars", { n: stage.stars });
      row.append(check, el("span", "", String(k)), stars);
      if (combat) {
        row.append(el("span", "", String(stage.level)));
        const rating = el("span", "num");
        if (stage.cp != null) rating.textContent = numbers.format(stage.cp);
        else {
          rating.textContent = "—";
          rating.classList.add("unknown");
          rating.title = i18n.t("trial.ratingUnknown");
        }
        row.append(rating);
      }
      row.addEventListener("click", () => set(nextTrialProgress(doneOf(m), k)));
      const li = el("li");
      li.append(row);
      list.append(li);
      return { row, check, k };
    });

    const hint = el("p", "trial-hint", i18n.t("trial.hint"));
    const button = el("button", "found-btn");
    button.type = "button";
    button.addEventListener("click", () => set(markAllProgress(doneOf(m), total)));

    function sync() {
      const done = doneOf(m);
      doneText.textContent = `${done}/${total}`;
      barFill.style.width = `${((100 * done) / total).toFixed(1)}%`;
      for (const { row, check, k } of rows) {
        row.classList.toggle("done", k <= done);
        row.classList.toggle("next", k === done + 1);
        row.setAttribute("aria-pressed", String(k <= done));
        row.setAttribute("aria-label", i18n.tf("trial.layer", { n: k }));
        check.textContent = k <= done ? "✓" : "";
      }
      button.textContent = i18n.t(done === total ? "trial.completed" : "trial.completeAll");
      button.classList.toggle("is-found", done === total);
      button.setAttribute("aria-pressed", String(done === total));
    }
    sync();
    return [head, bar, columns, list, hint, button];
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
      // The larger top padding keeps the popup below the zoom buttons, which are drawn above it.
      marker.bindPopup(() => makePopup(m, p), {
        className: "mk-popup-wrap", closeButton: true,
        autoPanPaddingTopLeft: [24, 110], autoPanPaddingBottomRight: [24, 24],
      });
      const record = { id: m.id, m, marker, group, entry: m.entry ?? null };
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
