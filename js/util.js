// Fetches JSON. If `fallback` is given, a missing file (404) yields it instead of throwing.
export async function fetchJson(url, fallback) {
  const res = await fetch(url);
  if (!res.ok) {
    if (fallback !== undefined) return fallback;
    throw new Error(`${url}: HTTP ${res.status}`);
  }
  return res.json();
}

// Tiny DOM helper: h("button", { class: "x", onclick: fn }, "text", childNode)
// Children are appended as text nodes or elements, never parsed as HTML.
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "class") el.className = value;
    else if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
    else if (value === true) el.setAttribute(key, "");
    else if (value !== false && value != null) el.setAttribute(key, value);
  }
  el.append(...children);
  return el;
}
