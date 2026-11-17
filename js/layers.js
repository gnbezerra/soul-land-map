import { gameToPixel, pixelToLatLng } from "./geo.js";
import {
  stageCount, stagesDone, isTrialComplete, isTrialStarted, nextTrialProgress, markAllProgress,
} from "./trials.js";
import { markerTitle, effectiveTags, popupFields, consumesContract } from "./popup.js";
import { createSheet } from "./sheet.js";

// Markers shrink when zoomed out so they do not pile up. Full size from the native zoom up;
// each level below it removes MARKER_SHRINK_PER_ZOOM, down to MARKER_MIN_SCALE.
const MARKER_SHRINK_PER_ZOOM = 0.25;
const MARKER_MIN_SCALE = 0.35;
// Below this scale the glyph is unreadable, so only the colored dot is shown (and icons lose their badges).
const MARKER_TINY_SCALE = 0.65;
// Icon box per tier (categories.json), in px at full scale: the hundreds of chests stay small, the types
// worth hunting for are big, and the ones the game's own minimap already shows (teleports, scenic spots,
// portals, visited once) are the smallest. Major icons are drawn above the chests around them.
const TIER_SIZE = { common: 22, major: 38, minor: 20 };
const TIER_Z = { major: 250 };

// Creates one Leaflet layer group per marker type and handles marker state:
// visibility per type, highlight, found (faded) and "hide found".
//   isFound(markerId) -> boolean          onSetFound(markerId, found)
//   trialDone(markerId) -> stages done    onSetTrial(markerId, stagesDone)   (Divine Trials)
//   linkFor(markerId) -> link to share    onPopupOpen(markerId)   onPopupClose(markerId)
// A Divine Trial counts as found once all its stages are done. On narrow screens popups open as a bottom
// sheet inside `sheetHost` (js/sheet.js), and the marker they belong to gets a ring.
export function createLayers({
  L, map, markers, entries, categories, calibration, nativeZoom, i18n, isFound, onSetFound, trialDone, onSetTrial,
  linkFor, onPopupOpen, onPopupClose, sheetHost,
}) {
  const layerByType = new Map();
  const recordsByEntry = new Map();
  const recordsById = new Map();
  const container = map.getContainer();
  let highlighted = null;
  let hideFound = false;
  // "Only this" on an entry: { type, entry }; the type's markers of other entries are taken off the map.
  let onlyEntry = null;
  // The record whose popup is open as a sheet (its marker has a ring).
  let selected = null;
  const sheet = createSheet({ map, host: sheetHost });
  // Hover tooltips only make sense with a mouse; on touch screens a tap opens the popup.
  const canHover = window.matchMedia("(hover: hover)").matches;

  function updateScale() {
    const scale = Math.max(MARKER_MIN_SCALE, 1 - MARKER_SHRINK_PER_ZOOM * Math.max(0, nativeZoom - map.getZoom()));
    container.style.setProperty("--mk-scale", scale.toFixed(3));
    container.classList.toggle("mk-tiny", scale < MARKER_TINY_SCALE);
  }
  map.on("zoom zoomend", updateScale);
  updateScale();

  // A pinch makes Leaflet move every marker on each frame (the buttons and the wheel animate the whole
  // pane once instead), which stutters on phones with a few hundred markers; hiding the pane until the
  // pinch ends keeps it smooth (measured on a Samsung A55).
  map.on("zoom", (e) => { if (e.pinch) container.classList.add("mk-pinching"); });
  map.on("zoomend moveend", () => container.classList.remove("mk-pinching"));

  const stagesOf = stageCount;
  const doneOf = (m) => stagesDone(trialDone(m.id), stagesOf(m));
  const isComplete = (m) => (stagesOf(m) ? isTrialComplete(doneOf(m), stagesOf(m)) : isFound(m.id));

  // Applies highlight, selection, found, the trial badge and "hide found" to one marker.
  function applyState(record) {
    const el = record.marker.getElement();
    const found = isComplete(record.m);
    if (el) {
      el.classList.toggle("hl", record.entry != null && record.entry === highlighted);
      el.classList.toggle("found", found);
      el.classList.toggle("selected", record === selected);
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
    record.marker.setZIndexOffset(record === selected ? 2000
      : record.entry != null && record.entry === highlighted ? 1000 : found ? -500
        : TIER_Z[categories.types[record.m.type].tier] ?? 0);
    const otherEntry = onlyEntry && record.m.type === onlyEntry.type && record.entry !== onlyEntry.entry;
    const shouldShow = !(hideFound && found) && !otherEntry;
    if (shouldShow && !record.group.hasLayer(record.marker)) record.group.addLayer(record.marker);
    else if (!shouldShow && record.group.hasLayer(record.marker)) record.group.removeLayer(record.marker);
  }

  // A game sprite when the type has one (an optional second sprite replaces it once found, and an
  // optional badge tells chests with the same sprite apart: a fixed text, a field of the marker such
  // as a co-op chest's number of players, or a small sprite); otherwise the colored dot with a letter.
  function makeIcon(m, meta) {
    const type = m.type;
    if (!meta.icon) {
      const dot = document.createElement("span");
      dot.className = "mk-dot";
      dot.dataset.type = type;
      dot.style.setProperty("--c", meta.color);
      dot.textContent = meta.glyph;
      return L.divIcon({ html: dot, className: "mk", iconSize: [24, 24] });
    }
    const tier = meta.tier ?? "common";
    // `size` overrides the tier for thin sprites, which look smaller than a chest in the same box.
    const size = meta.size ?? TIER_SIZE[tier] ?? TIER_SIZE.common;
    const box = document.createElement("span");
    box.className = `mk-ic${meta.iconFound ? " has-found" : ""}`;
    box.dataset.type = type;
    box.style.setProperty("--c", meta.color);
    box.style.setProperty("--sz", `${size}px`);
    for (const [src, cls] of [[meta.icon, "ic-main"], [meta.iconFound, "ic-found"]]) {
      if (!src) continue;
      const img = document.createElement("img");
      img.src = src;
      img.alt = "";
      img.className = cls;
      img.draggable = false;
      box.append(img);
    }
    const badgeText = meta.badgeField ? m[meta.badgeField] : meta.badge;
    if (badgeText != null && badgeText !== "") {
      const badge = document.createElement("span");
      badge.className = "mk-type-badge";
      badge.textContent = badgeText;
      box.append(badge);
    } else if (meta.badgeIcon) {
      const badge = document.createElement("img");
      badge.src = meta.badgeIcon;
      badge.alt = "";
      badge.className = "mk-icon-badge";
      badge.draggable = false;
      box.append(badge);
    }
    return L.divIcon({ html: box, className: `mk mk-${tier}`, iconSize: [size, size] });
  }

  const titleOf = (m) => markerTitle(m, i18n);
  const latLngOf = (x, y) => pixelToLatLng(map, nativeZoom, ...gameToPixel(calibration, x, y));

  function makeTooltip(m, point) {
    const box = document.createElement("div");
    const strong = document.createElement("strong");
    strong.textContent = titleOf(m);
    const small = document.createElement("div");
    small.textContent = `${i18n.t(`type.${m.type}`)} · ${m.id} · ${point.x}, ${point.y}`;
    box.append(strong, small);
    return box;
  }

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };

  // "Show solution": the howto stays hidden until asked for, so it does not spoil the search.
  function makeHowto(text) {
    const toggle = el("button", "howto-btn");
    toggle.type = "button";
    const body = el("p", "howto", text);
    const set = (open) => {
      body.hidden = !open;
      toggle.textContent = `${open ? "▾" : "▸"} ${i18n.t(open ? "popup.hideSolution" : "popup.showSolution")}`;
      toggle.setAttribute("aria-expanded", String(open));
    };
    toggle.addEventListener("click", () => set(body.hidden));
    set(false);
    return [toggle, body];
  }

  // Marker id and position, and a button that copies the marker's link (clipboard, else a prompt).
  function makeFooter(m, point) {
    const foot = el("div", "mk-foot");
    const button = el("button", "copy-link", `🔗 ${i18n.t("popup.copyLink")}`);
    button.type = "button";
    button.addEventListener("click", async () => {
      const link = linkFor(m.id);
      try {
        await navigator.clipboard.writeText(link);
      } catch {
        window.prompt(i18n.t("popup.copyPrompt"), link);
        return;
      }
      button.textContent = `✓ ${i18n.t("popup.linkCopied")}`;
      button.classList.add("done");
      setTimeout(() => {
        button.textContent = `🔗 ${i18n.t("popup.copyLink")}`;
        button.classList.remove("done");
      }, 2000);
    });
    foot.append(el("span", "muted small", `${m.id} · X ${point.x}, Y ${point.y}`), button);
    return foot;
  }

  // Popup content is built on every open, so it always reflects the current state.
  function makePopup(m, point) {
    const root = el("div", "mk-popup");
    const kind = el("div", "muted", i18n.t(`type.${m.type}`));
    if (stagesOf(m) && m.subtype) kind.textContent += ` · ${i18n.t(`trial.${m.subtype}`, m.subtype)}`;
    root.append(el("strong", "", titleOf(m)), kind);

    const tags = effectiveTags(m, entries);
    if (tags.length) {
      const list = el("div", "mk-tags");
      for (const tag of tags) {
        const chip = el("span", "mk-tag", i18n.t(`tag.${tag}`, tag));
        const hint = i18n.t(`tag.${tag}.hint`, "");
        if (hint) chip.title = hint;
        list.append(chip);
      }
      root.append(list);
    }

    const description = m.entry ? i18n.entry(m.entry).description : "";
    if (description) root.append(el("p", "desc", description));
    // Own note (e.g. "inside the cave under the plains"), always shown.
    const { note, howto } = i18n.marker(m.id);
    if (note) root.append(el("p", "note", note));
    if (howto) root.append(...makeHowto(howto));

    const fields = popupFields(m, i18n);
    if (fields.length) {
      const dl = el("dl");
      for (const { field, value } of fields) {
        const dd = el("dd", "", value);
        // The popup may cover the pillar (it opens above the chest), so the pillar can be framed on its own.
        if (field === "pillar" && pillars.has(m.id)) {
          const show = el("button", "show-on-map", i18n.t("popup.showOnMap"));
          show.type = "button";
          show.addEventListener("click", () => showPillar(m.id));
          dd.append(" ", show);
        }
        dl.append(el("dt", "", i18n.t(`field.${field}`, field)), dd);
      }
      root.append(dl);
    }
    if (consumesContract(m)) root.append(el("div", "warn", `⚠ ${i18n.t("popup.contractWarning")}`));

    // The main button and the footer stay in view at the bottom of the sheet (css/style.css, `.mk-actions`).
    const actions = el("div", "mk-actions");
    if (stagesOf(m)) {
      const section = makeTrialSection(m);
      actions.append(section.pop(), makeFooter(m, point));
      root.append(...section, actions);
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
    actions.append(button, makeFooter(m, point));
    root.append(actions);
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

  // Challenge chests' pillar layers by marker id, and the one kept on the map by "Show on map".
  const pillars = new Map();
  let pinnedPillar = null;
  function unpinPillar() {
    pinnedPillar?.remove();
    pinnedPillar = null;
  }
  // Closes the popup and frames the chest and its pillar, keeping the pin and the line on the map.
  function showPillar(markerId) {
    const { layer, marker } = pillars.get(markerId);
    pinnedPillar = layer;
    layer.addTo(map);
    map.closePopup();
    const bounds = L.latLngBounds(layer.getLayers().map((l) => l.getLatLngs?.() ?? [l.getLatLng()]).flat())
      .extend(marker.getLatLng());
    map.fitBounds(bounds.pad(0.6), { maxZoom: nativeZoom });
  }
  map.on("click", unpinPillar);

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
      const marker = L.marker(latLngOf(p.x, p.y), { icon: makeIcon(m, meta) });
      if (canHover) marker.bindTooltip(makeTooltip(m, p));
      // The larger top padding keeps the popup below the zoom buttons, which are drawn above it. A sheet
      // frames its marker itself, so autoPan follows the screen width at the moment the popup opens.
      const popup = L.popup({
        className: "mk-popup-wrap", closeButton: true,
        autoPanPaddingTopLeft: [24, 110], autoPanPaddingBottomRight: [24, 24],
      });
      Object.defineProperty(popup.options, "autoPan", { get: () => !sheet.active() });
      marker.bindPopup(popup.setContent(() => makePopup(m, p)));
      const record = { id: m.id, m, marker, group, entry: m.entry ?? null };
      marker.on("add", () => applyState(record));
      // A challenge chest's pillar (where the jumping puzzle starts): a pin tied to the chest by a dashed
      // line, shown while the chest's popup is open, or after "Show on map" until the next map click.
      const pillar = m.pillar && L.layerGroup([
        L.polyline([latLngOf(m.pillar.x, m.pillar.y), marker.getLatLng()], {
          className: "pillar-line", color: meta.color, weight: 2.5, dashArray: "7 6", interactive: false,
        }),
        L.circleMarker(latLngOf(m.pillar.x, m.pillar.y), {
          className: "pillar-pin", radius: 6, color: meta.color, weight: 2, fillColor: "#10151b", fillOpacity: 1,
          interactive: false,
        }),
      ]);
      if (pillar && !pillars.has(m.id)) pillars.set(m.id, { layer: pillar, marker });
      marker.on("popupopen", (e) => {
        unpinPillar();
        pillar?.addTo(map);
        if (sheet.active()) {
          selected = record;
          applyState(record);
          sheet.show(e.popup, m.pillar ? [marker.getLatLng(), latLngOf(m.pillar.x, m.pillar.y)] : [marker.getLatLng()]);
        }
        onPopupOpen?.(m.id);
      });
      marker.on("popupclose", () => {
        if (pillar !== pinnedPillar) pillar?.remove();
        if (selected === record) {
          selected = null;
          applyState(record);
          sheet.hide();
        }
        onPopupClose?.(m.id);
      });
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
    // Shows only this entry's markers of its type (null: all of them).
    setOnlyEntry(entryId) {
      const type = entryId ? recordsByEntry.get(entryId)?.[0]?.m.type : null;
      onlyEntry = type ? { type, entry: entryId } : null;
      allRecords().forEach(applyState);
    },
    setHideFound(value) {
      hideFound = value;
      allRecords().forEach(applyState);
    },
    highlight(entryId) {
      highlighted = entryId;
      allRecords().forEach(applyState);
    },
    // Centers a marker (its first point) and opens its popup, e.g. from a deep link. A marker removed by
    // "hide found" is put back on the map for it. Returns false for an unknown id.
    openMarker(markerId) {
      const record = recordsById.get(markerId)?.[0];
      if (!record) return false;
      if (!record.group.hasLayer(record.marker)) record.group.addLayer(record.marker);
      map.setView(record.marker.getLatLng(), Math.max(map.getZoom(), nativeZoom - 1), { animate: false });
      record.marker.openPopup();
      return true;
    },
    // From the sidebar's item list: a marker with one point opens as from a deep link; one with several
    // points (some encounters) frames them all first, then opens on its first point.
    focusMarker(markerId) {
      const records = recordsById.get(markerId);
      if (!records?.length) return false;
      if (records.length === 1) return this.openMarker(markerId);
      for (const r of records) if (!r.group.hasLayer(r.marker)) r.group.addLayer(r.marker);
      map.fitBounds(L.latLngBounds(records.map((r) => r.marker.getLatLng())).pad(0.3), { maxZoom: nativeZoom + 1, animate: false });
      records[0].marker.openPopup();
      return true;
    },
    typeOf(markerId) {
      return recordsById.get(markerId)?.[0]?.m.type ?? null;
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
