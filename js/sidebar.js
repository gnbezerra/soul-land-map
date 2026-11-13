import { h } from "./util.js";
import { formatCount } from "./model.js";

// Renders the filter sidebar: one row per game category (group), nested rows for its
// types when it has several, and an optional expandable list of exploration entries.
//   isVisible(typeId) -> boolean
//   onToggle(typeIds, visible)
//   onFocusEntry(entryId, typeId)
// Call refresh() after the visibility state changes.
export function createSidebar({ container, model, i18n, isVisible, onToggle, onFocusEntry }) {
  const typeInputs = new Map();
  const groupInputs = [];
  const t = i18n.t;

  const dot = (type) => h("span", { class: "dot", style: `background:${type.color}` });
  const count = (loaded, expected) => h("span", { class: "count", title: t("ui.countHint") }, formatCount(loaded, expected));

  function typeCheckbox(type, label, nested) {
    const input = h("input", { type: "checkbox" });
    input.addEventListener("change", () => onToggle([type.id], input.checked));
    typeInputs.set(type.id, input);
    const row = h("label", { class: `row${nested ? " nested" : ""}` },
      input, dot(type), h("span", { class: "name" }, label), count(type.loaded, type.expected));
    return row;
  }

  // Entries are listed only when some entry has more than one marker (e.g. chest sets).
  function entryList(type) {
    if (!type.entries.some((e) => e.size > 1)) return null;
    const list = h("ul", { class: "entries", hidden: true },
      ...type.entries.map((e) => h("li", {},
        h("button", { type: "button", class: "entry", onclick: () => onFocusEntry(e.id, type.id) },
          h("span", { class: "name" }, i18n.entry(e.id).name),
          count(e.loaded, e.size)))));
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
    const head = h("label", { class: "row group-head" }, input, h("span", { class: "name" }, label), count(group.loaded, group.expected));
    return h("div", { class: "block" }, head, ...group.types.map((type) => typeBlock(type, t(`type.${type.id}`), true)));
  }

  const allTypeIds = model.groups.flatMap((g) => g.types.map((x) => x.id));
  container.replaceChildren(
    h("h2", {}, t("ui.filters")),
    h("div", { class: "bulk" },
      h("button", { type: "button", onclick: () => onToggle(allTypeIds, true) }, t("ui.showAll")),
      h("button", { type: "button", onclick: () => onToggle(allTypeIds, false) }, t("ui.hideAll"))),
    ...model.groups.map(groupBlock),
  );

  function refresh() {
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
  return { refresh };
}
