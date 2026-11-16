import { h } from "./util.js";
import { formatCount, isUnlisted, splitUnlisted } from "./model.js";
import { milestoneMarks, milestoneStatus } from "./exploration.js";

// Renders the filter sidebar: one row per game category (group), nested rows for its
// types when it has several, and an optional expandable list of exploration entries.
//   isVisible(typeId) -> boolean         onToggle(typeIds, visible)
//   isHideFound() -> boolean             onHideFound(hide)
//   onFocusEntry(entryId, typeId)
//   onExport()                           onImport(file)
// `milestones`: the map's exploration reward milestones (data/maps.json), drawn on the exploration bar.
// Call refresh() after visibility changes and refreshCounts() after progress changes.
export function createSidebar({
  container, model, milestones = [], i18n, isVisible, onToggle, isHideFound, onHideFound, onFocusEntry, onExport,
  onImport,
}) {
  const typeInputs = new Map();
  const groupInputs = [];
  const counters = []; // { el, read: () => [found, total] }
  const t = i18n.t;

  // The legend shows the marker's own sprite (with its badge sprite, if any); types without one keep the
  // colored dot.
  const dot = (type) => type.icon
    ? h("span", { class: "dot-ic" }, h("img", { src: type.icon, alt: "" }),
      ...(type.badgeIcon ? [h("img", { src: type.badgeIcon, alt: "", class: "dot-badge" })] : []))
    : h("span", { class: "dot", style: `background:${type.color}` });
  function count(read) {
    const el = h("span", { class: "count", title: t("ui.countHint") });
    counters.push({ el, read });
    return el;
  }

  function typeCheckbox(type, label, nested) {
    const input = h("input", { type: "checkbox" });
    input.addEventListener("change", () => onToggle([type.id], input.checked));
    typeInputs.set(type.id, input);
    const row = h("label", { class: `row${nested ? " nested" : ""}` },
      input, dot(type), h("span", { class: "name" }, label), count(() => [type.found, type.total]));
    return row;
  }

  // Entries are listed only when some entry has more than one marker (e.g. chest sets). The site's own
  // entries for what the game lists in no entry come last, after a separator (SPEC 4.3).
  function entryList(type) {
    if (!type.entries.some((e) => e.size > 1)) return null;
    const { listed, unlisted } = splitUnlisted(type.entries);
    const item = (e) => h("li", {},
      h("button", { type: "button", class: `entry${isUnlisted(e) ? " unlisted" : ""}`, onclick: () => onFocusEntry(e.id, type.id) },
        h("span", { class: "name" }, i18n.entry(e.id).name),
        count(() => [e.found, e.size])));
    const list = h("ul", { class: "entries", hidden: true },
      ...listed.map(item),
      ...(listed.length && unlisted.length ? [h("li", { class: "entries-sep", role: "presentation" })] : []),
      ...unlisted.map(item));
    const toggle = h("button", { type: "button", class: "expander", "aria-expanded": "false", title: t("ui.expand") }, "▸");
    toggle.addEventListener("click", () => {
      const open = list.hidden;
      list.hidden = !open;
      toggle.setAttribute("aria-expanded", String(open));
      toggle.title = t(open ? "ui.collapse" : "ui.expand");
      toggle.textContent = open ? "▾" : "▸";
    });
    return { toggle, list };
  }

  function typeBlock(type, label, nested) {
    const entries = entryList(type);
    const line = h("div", { class: "line" }, typeCheckbox(type, label, nested), ...(entries ? [entries.toggle] : []));
    return h("div", { class: "block" }, line, ...(entries ? [entries.list] : []));
  }

  function groupBlock(group) {
    const label = t(`group.${group.id}`);
    if (group.types.length === 1) return typeBlock(group.types[0], label, false);

    const input = h("input", { type: "checkbox" });
    input.addEventListener("change", () => onToggle(group.types.map((x) => x.id), input.checked));
    groupInputs.push({ input, group });
    const head = h("label", { class: "row group-head" }, input, h("span", { class: "name" }, label), count(() => [group.found, group.total]));
    return h("div", { class: "block" }, head, ...group.types.map((type) => typeBlock(type, t(`type.${type.id}`), true)));
  }

  // Exploration value in the game's points, with the reward milestones as marks on the bar, the next
  // reward below it and the scoring rules behind the (i) button (js/exploration.js). Only categories
  // with data contribute to the total.
  const barFill = h("div", { class: "bar-fill" });
  const barText = h("span", { class: "count" });
  const barTrack = h("div", { class: "bar xp-bar", role: "presentation" }, barFill);
  const nextReward = h("div", { class: "xp-next" });
  const rulesRows = h("tbody");
  const sortedMilestones = [...milestones].sort((a, b) => a - b);
  const rules = h("div", { class: "xp-rules", id: "xp-rules", hidden: true },
    h("strong", {}, t("xp.title")),
    h("table", {}, rulesRows),
    ...(sortedMilestones.length
      ? [h("div", { class: "foot" }, i18n.tf("xp.rewardsAt", { list: sortedMilestones.join(" · ") }))]
      : []));
  const info = h("button", {
    type: "button", class: "xp-info", "aria-expanded": "false", "aria-controls": "xp-rules",
    title: t("xp.rulesHint"), "aria-label": t("xp.rulesHint"),
  }, "i");
  info.addEventListener("click", () => {
    rules.hidden = !rules.hidden;
    info.setAttribute("aria-expanded", String(!rules.hidden));
  });
  const bar = h("div", { class: "exploration" },
    h("div", { class: "exploration-head" }, h("span", {}, t("ui.exploration"), info), barText),
    barTrack, nextReward, rules);

  // Fills {placeholders} like i18n.tf, wrapping the ones listed in `bold` in <b>.
  function fill(text, vars, bold) {
    return text.split(/(\{\w+\})/).filter(Boolean).map((part) => {
      const name = part.match(/^\{(\w+)\}$/)?.[1];
      if (!name || !(name in vars)) return part;
      return bold.includes(name) ? h("b", {}, String(vars[name])) : String(vars[name]);
    });
  }

  function refreshExploration() {
    const { found, total } = model.exploration;
    barText.textContent = formatCount(found, total);
    barFill.style.width = total ? `${((100 * found) / total).toFixed(1)}%` : "0%";
    barTrack.replaceChildren(barFill, ...milestoneMarks(milestones, found, total).map((m) =>
      h("i", { class: m.reached ? "xp-tick reached" : "xp-tick", style: `left:${m.percent.toFixed(2)}%` })));
    const status = milestoneStatus(found, milestones);
    nextReward.hidden = status.none;
    if (status.next == null) nextReward.textContent = t("xp.allRewards");
    else nextReward.replaceChildren(...fill(t("xp.nextReward"), { points: status.next, left: status.left }, ["points"]));
    rulesRows.replaceChildren(...model.exploration.rules.map((r) => h("tr", {},
      h("td", { class: "pts" }, `+${r.points}`),
      h("td", {}, t(`xp.rule.${r.id}`)),
      h("td", { class: "got" }, formatCount(r.found, r.total)))));
  }

  const hideFoundInput = h("input", { type: "checkbox" });
  hideFoundInput.addEventListener("change", () => onHideFound(hideFoundInput.checked));

  const fileInput = h("input", { type: "file", accept: "application/json,.json", hidden: true });
  fileInput.addEventListener("change", () => {
    const file = fileInput.files[0];
    fileInput.value = ""; // allows picking the same file again
    if (file) onImport(file);
  });
  const message = h("div", { class: "message", role: "status" });

  const allTypeIds = model.groups.flatMap((g) => g.types.map((x) => x.id));
  container.replaceChildren(
    bar,
    h("h2", {}, t("ui.filters")),
    h("div", { class: "bulk" },
      h("button", { type: "button", onclick: () => onToggle(allTypeIds, true) }, t("ui.showAll")),
      h("button", { type: "button", onclick: () => onToggle(allTypeIds, false) }, t("ui.hideAll"))),
    h("label", { class: "row" }, hideFoundInput, h("span", { class: "name" }, t("ui.hideFound"))),
    ...model.groups.map(groupBlock),
    h("section", { class: "backup" },
      h("h2", {}, t("ui.backup")),
      h("div", { class: "bulk" },
        h("button", { type: "button", onclick: () => onExport() }, t("ui.export")),
        h("button", { type: "button", onclick: () => fileInput.click() }, t("ui.import")),
        fileInput),
      h("p", { class: "hint" }, t("ui.backupHint")),
      message),
    h("p", { class: "disclaimer" }, t("ui.disclaimer")),
  );

  function refreshCounts() {
    for (const { el, read } of counters) el.textContent = formatCount(...read());
    refreshExploration();
  }

  function refresh() {
    hideFoundInput.checked = isHideFound();
    for (const [id, input] of typeInputs) {
      input.checked = isVisible(id);
      input.closest(".row").classList.toggle("off", !input.checked);
    }
    for (const { input, group } of groupInputs) {
      const on = group.types.filter((x) => isVisible(x.id)).length;
      input.checked = on === group.types.length;
      input.indeterminate = on > 0 && on < group.types.length;
      input.closest(".row").classList.toggle("off", on === 0);
    }
  }
  refresh();
  refreshCounts();
  return {
    refresh,
    refreshCounts,
    showMessage(text, isError = false) {
      message.textContent = text;
      message.classList.toggle("error", isError);
    },
  };
}
