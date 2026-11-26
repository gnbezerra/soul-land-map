// Browser test: drives a headless Chrome over the DevTools protocol against the real site (real
// vendored Leaflet). Dependency-free: Node's built-in fetch and WebSocket, plus a small static server.
//
//   node tests/browser.mjs                    run the checks
//   node tests/browser.mjs --shots <dir>      also save desktop and mobile screenshots
//   node tests/browser.mjs --only <text>      run only the checks whose name contains <text> (to repeat one)
//   CHROME=<path> node tests/browser.mjs      use another Chrome or Chromium binary
//
// It is not part of `node --test tests/` (slower, needs Chrome). Expected values come from the generated
// data and js/model.js, so adding markers does not break it. Exit code 1 if a check fails.
// Not covered: real wheel and double-click zoom (synthetic input does not zoom headless Chrome). Pinch is
// driven through Leaflet's own touch handler (DevTools touch events), not the browser's native gesture.
//
// Gotchas when extending it:
// - Navigating to the URL already open, or to one that differs only in the hash, does not reload the
//   page. Use load(), which reloads in that case and waits for the new document.
// - Click marker icons with dispatchEvent (they may be off screen), and wait for each popup to appear
//   instead of sleeping a fixed time.
// - Popups pan into view with an animation: wait for it before measuring a popup's position.
// - Input.dispatchTouchEvent is silently dropped until the page has drawn a frame: wait for two
//   animation frames after a load before touching.
// - Chrome's first start on a fresh machine (a CI runner) can take over 10 s: keep the startup waits generous.
// - Chrome stalls now and then for several seconds, most often right after the heavy "every marker" script
//   (341 popups in one go): about one run in ten timed out a 5-10 s wait before the waits below were raised.
//   Waits on a page load, a reload or tiles get 15-20 s (they return as soon as the page is ready, so this
//   costs nothing when nothing stalls), and a dropped touch gesture is tried again. Each check prints how
//   long it took, and a timed-out wait prints what the page looked like.
// Waits on a page load and on tiles: generous, see above.
const LOAD_WAIT = 20000;
const TILE_WAIT = 15000;
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { buildModel } from "../js/model.js";
import { gameToPixel } from "../js/geo.js";
import { loadI18n } from "../js/i18n.js";
import { markerTitle, effectiveTags } from "../js/popup.js";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const MAP = "nuoding";
const args = process.argv.slice(2);
const SHOTS = args.includes("--shots") ? resolve(args[args.indexOf("--shots") + 1]) : null;
const ONLY = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const json = (path) => JSON.parse(readFileSync(join(ROOT, path), "utf8"));

// --- Expected values, from the data ------------------------------------------------------------
const categories = json("data/categories.json");
const markers = json(`data/markers/${MAP}.json`);
const model = buildModel(categories, json(`data/entries/${MAP}.json`), markers);
const ui = { en: json("i18n/en.json"), pt: json("i18n/pt.json") };
const markerNames = json(`i18n/markers.${MAP}.en.json`);
const markerNamesPt = json(`i18n/markers.${MAP}.pt.json`);
const trialIcon = categories.types.divine_trial.icon;
const trialTotal = model.types.get("divine_trial").total;
const barTotal = model.exploration.total; // exploration value, in points
// Points of one marker of a type (one layer, for a Divine Trial), from data/categories.json.
const pointsOf = (type) => categories.explorationRules.find((r) => r.types.includes(type))?.points ?? 0;
const milestones = [...(json("data/maps.json")[MAP].exploration?.milestones ?? [])].sort((a, b) => a - b);
const trials = markers.filter((m) => m.type === "divine_trial" && m.stages?.length);
const longTrial = trials.filter((m) => m.subtype === "combat").sort((a, b) => b.stages.length - a.stages.length)[0];
const puzzle = trials.find((m) => m.subtype === "puzzle");
const topTrial = [...trials].sort((a, b) => b.y - a.y)[0]; // nearest the top edge (game y grows upwards)
const chest = markers.find((m) => m.type === "chest_normal");
const nameOf = (m) => markerNames[m.id]?.name;
// The site's English texts, loaded from disk the way the page loads them.
const i18nEn = await loadI18n("en", MAP, async (url, fallback) => (existsSync(join(ROOT, url)) ? json(url) : fallback));
const entriesData = json(`data/entries/${MAP}.json`);
const withHowto = markers.find((m) => markerNames[m.id]?.howto);
const tagged = markers.filter((m) => effectiveTags(m, entriesData).length).sort((a, b) =>
  effectiveTags(b, entriesData).length - effectiveTags(a, entriesData).length)[0];
const contractChest = markers.find((m) => m.type === "chest_contract");
const pillarChest = markers.find((m) => m.pillar);
const mapCfg = json("data/maps.json")[MAP];
// Image pixel of every icon: encounters with several points draw one icon per point.
const iconPixels = markers.flatMap((m) => (m.points ?? [m]).map((p) => gameToPixel(mapCfg.calibration, p.x, p.y)));

// --- Static server ------------------------------------------------------------------------------
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".webp": "image/webp", ".png": "image/png", ".svg": "image/svg+xml",
  ".ico": "image/x-icon" };
// Every request, so a wait that times out can tell whether the server ever saw the file it waited for.
const served = []; // { path, at (ms since start), ms }
const started = Date.now();
// What /version.json serves when set (the deployed site's file, written by CI); otherwise the committed
// placeholder. Never cached, so a check can change it between two loads.
let versionJson = null;
const server = createServer((req, res) => {
  const t0 = Date.now();
  const pathname = new URL(req.url, "http://x").pathname;
  if (pathname === "/version.json" && versionJson) {
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end(versionJson);
    served.push({ path: pathname, at: t0 - started, ms: Date.now() - t0 });
    return;
  }
  const path = normalize(join(ROOT, decodeURIComponent(pathname)));
  const file = path.endsWith(sep) ? join(path, "index.html") : path;
  if (!file.startsWith(ROOT) || !existsSync(file)) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" });
  res.end(readFileSync(file));
  served.push({ path: pathname, at: t0 - started, ms: Date.now() - t0 });
});
// "seen 3x, last 812 ms ago" for a URL, or "never asked for".
function servedNote(url) {
  const path = new URL(url, BASE).pathname;
  const hits = served.filter((r) => r.path === path);
  if (!hits.length) return "never asked for";
  const last = hits[hits.length - 1];
  return `served ${hits.length}x, last ${Date.now() - started - last.at} ms ago in ${last.ms} ms`;
}
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${server.address().port}/`;

// --- Chrome -------------------------------------------------------------------------------------
const chromePath = process.env.CHROME ?? [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
].find(existsSync);
if (!chromePath) {
  console.error("Chrome not found; set CHROME to its path.");
  process.exit(2);
}
const temp = mkdtempSync(join(tmpdir(), "slmap-test-"));
const profile = join(temp, "profile");
const chrome = spawn(chromePath, ["--headless=new", "--remote-debugging-port=0", "--no-first-run",
  "--no-default-browser-check", "--disable-gpu", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });

// Chrome writes the port it picked into <profile>/DevToolsActivePort, then opens its page target. A cold
// start on a fresh CI runner can take well over 10 s, so wait up to 30 s for each and fail with a clear
// message instead of carrying on with an undefined port.
let chromeExit = null;
chrome.on("exit", (code, signal) => { chromeExit = signal ?? code; });
async function waitFor(what, get, timeoutMs = 30000) {
  for (const deadline = Date.now() + timeoutMs; Date.now() < deadline;) {
    if (chromeExit !== null) throw new Error(`Chrome exited (${chromeExit}) while waiting for ${what}`);
    const value = await get().catch(() => null);
    if (value) return value;
    await wait(100);
  }
  throw new Error(`timed out after ${timeoutMs / 1000} s waiting for ${what}`);
}
let page;
try {
  const port = await waitFor("its DevToolsActivePort file",
    async () => readFileSync(join(profile, "DevToolsActivePort"), "utf8").split("\n")[0].trim());
  page = await waitFor("its page target", async () => {
    const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    return targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
  });
} catch (error) {
  console.error(`Could not connect to Chrome: ${error.message}`);
  chrome.kill();
  server.close();
  await wait(300);
  try { rmSync(temp, { recursive: true, force: true }); } catch { /* Chrome may still hold files on Windows */ }
  process.exit(2);
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));

let nextId = 0;
const pending = new Map();
const pageErrors = [];
let lastDialog = null; // text of the last confirm() the page showed (accepted automatically)
ws.addEventListener("message", (event) => {
  const m = JSON.parse(event.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
  if (m.method === "Runtime.exceptionThrown") {
    pageErrors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
  }
  if (m.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(m.params.type)) {
    pageErrors.push(`console.${m.params.type}: ${m.params.args.map((a) => a.value ?? a.description).join(" ")}`);
  }
  if (m.method === "Network.responseReceived" && m.params.response.status >= 400) {
    pageErrors.push(`${m.params.response.status} ${m.params.response.url}`);
  }
  if (m.method === "Network.loadingFailed" && !m.params.canceled) pageErrors.push(`failed: ${m.params.errorText}`);
  if (m.method === "Page.javascriptDialogOpening") {
    lastDialog = m.params.message;
    send("Page.handleJavaScriptDialog", { accept: true });
  }
});
function send(method, params = {}) {
  return new Promise((r) => {
    const id = ++nextId;
    pending.set(id, r);
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function ev(expression) {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(`${expression}\n${r.result.exceptionDetails.exception?.description}`);
  return r.result?.result?.value;
}
// Polls a page expression until it is truthy. It looks once more after the deadline (an evaluation that
// was slow to answer must not use up the time). On a timeout, the error says how slow the slowest
// evaluation was and, given `diagnose` (a page expression), what the page looked like.
async function until(expression, label, timeout = 3000, diagnose = null) {
  const end = Date.now() + timeout;
  let slowest = 0;
  let polls = 0;
  for (;;) {
    const t0 = Date.now();
    const value = await ev(expression).catch(() => undefined);
    slowest = Math.max(slowest, Date.now() - t0);
    polls++;
    if (value) return value;
    if (Date.now() >= end) break;
    await wait(30);
  }
  let state = "";
  if (diagnose) {
    const d = await ev(diagnose).catch((e) => `(could not read the page: ${e.message.split("\n")[0]})`);
    state = `\n${typeof d === "string" ? d : JSON.stringify(d)}`;
  }
  throw new Error(`timed out waiting for ${label} (${timeout} ms, ${polls} polls, slowest ${slowest} ms)${state}`);
}
// What a page that should be loading looks like.
const PAGE_STATE = `JSON.stringify({ stale: !!window.__stale, ready: document.readyState, href: location.href,
  icons: document.querySelectorAll(".leaflet-marker-icon").length, count: !!document.querySelector(".exploration .count"),
  lang: document.documentElement.lang })`;
await send("Runtime.enable");
await send("Network.enable");
await send("Page.enable");
await send("DOM.enable");

// --- Checks -------------------------------------------------------------------------------------
let failures = 0;
// Each check prints how long it took, so a slow machine or a slow step shows up next to a timeout.
async function check(name, fn) {
  if (ONLY && !name.includes(ONLY)) return;
  const t0 = Date.now();
  const took = () => `(${((Date.now() - t0) / 1000).toFixed(1)} s)`;
  try {
    await fn();
    console.log(`ok    ${name} ${took()}`);
  } catch (error) {
    failures++;
    console.log(`FAIL  ${name} ${took()}\n      ${error.message.split("\n").join("\n      ")}`);
  }
}
function equal(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}: expected ${e}, got ${a}`);
}

async function viewport(width, height, mobile, deviceScaleFactor = 2) {
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor, mobile });
  await send("Emulation.setTouchEmulationEnabled", { enabled: mobile });
}
// Always a real page load: navigating to the URL already open (or one that differs only in the hash)
// would not reload the page, so that case uses Page.reload. The old document is flagged first, so the
// wait below cannot be satisfied by it.
async function load(query = "?lang=en") {
  const url = `${BASE}${query}`;
  const current = await ev(`window.__stale = true; location.href.split("#")[0]`);
  if (current === url) await send("Page.reload");
  else await send("Page.navigate", { url });
  await until(`!window.__stale && document.querySelectorAll(".leaflet-marker-icon").length > 0 && !!document.querySelector(".exploration .count")`, "the map", LOAD_WAIT, PAGE_STATE);
}
async function freshLoad(query) {
  await load(query);
  await ev(`localStorage.clear()`);
  await load(query);
}
async function shot(name) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  const { result } = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(result.data, "base64"));
}

// Screenshot of the "only this" chip turned on (Divine Mind Crystals), then off again.
async function shotChip(lang) {
  if (!SHOTS) return;
  await ev(`document.querySelector('.solo[data-types="crystal"]').click()`);
  await wait(300);
  await shot(`mobile-solo-chip-${lang}`);
  await ev(`document.querySelector(".solo-chip button").click()`);
}

const ICONS = `[...document.querySelectorAll(".leaflet-marker-icon")]`;
// Types that start hidden (categories.json `defaultHidden`) and have markers on this map; a type's checkbox.
const defaultHiddenHere = Object.keys(categories.types).filter((t) => categories.types[t].defaultHidden &&
  markers.some((m) => m.type === t));
const typeBox = (t) => `document.querySelector('.solo[data-types="${t}"]:not([data-entry])').closest(".line").querySelector("input")`;
const iconsOf = (type) => `${ICONS}.filter((e) => e.querySelector("[data-type]")?.dataset.type === "${type}")`;
const TRIAL_ICONS = iconsOf("divine_trial");
const POPUP = `document.querySelector(".leaflet-popup .mk-popup")`;
const popupTitle = () => ev(`${POPUP}?.querySelector("strong")?.textContent ?? null`);

async function closePopup() {
  await ev(`document.querySelector(".leaflet-popup-close-button")?.click()`);
  await until(`!document.querySelector(".leaflet-popup")`, "the popup to close");
}
// Opens the popup of one icon and returns its title.
async function openIcon(list, i) {
  if (await ev(`!!document.querySelector(".leaflet-popup")`)) await closePopup();
  await ev(`${list}[${i}].dispatchEvent(new MouseEvent("click", { bubbles: true }))`);
  return until(`${POPUP}?.querySelector("strong")?.textContent`, `popup of icon ${i}`);
}
// Opens the popup whose title is `title` among the trial icons; returns the icon index.
async function openTrial(title) {
  const n = await ev(`${TRIAL_ICONS}.length`);
  for (let i = 0; i < n; i++) if ((await openIcon(TRIAL_ICONS, i)) === title) return i;
  throw new Error(`no trial popup titled ${title}`);
}
const counts = () => ev(`(() => {
  const row = [...document.querySelectorAll("#sidebar .row")].find((r) => r.querySelector(".dot-ic img")?.getAttribute("src") === "${trialIcon}");
  return { trial: row?.querySelector(".count")?.textContent, bar: document.querySelector(".exploration .count").textContent };
})()`);
const trialPopup = () => ev(`(() => {
  const p = ${POPUP};
  return { done: p.querySelector(".trial-head b").textContent,
    rows: [...p.querySelectorAll(".trial-stage")].map((r) => r.classList.contains("done") ? "D" : r.classList.contains("next") ? "N" : ".").join(""),
    button: p.querySelector(".found-btn").textContent, hint: !p.querySelector(".trial-hint").hidden };
})()`);
async function clickLayer(k) {
  const before = await trialPopup();
  await ev(`${POPUP}.querySelectorAll(".trial-stage")[${k - 1}].click()`);
  await until(`${POPUP}.querySelector(".trial-head b").textContent !== ${JSON.stringify(before.done)}`, `layer ${k}`, 1000).catch(() => {});
  return (await trialPopup()).done;
}
async function clickPopupButton() {
  await ev(`${POPUP}.querySelector(".found-btn").click()`);
  await wait(50);
}
const iconState = (list, i) => ev(`(() => { const e = ${list}[${i}]; const b = e.querySelector(".mk-badge");
  return { found: e.classList.contains("found"), badge: b && !b.hidden ? b.textContent : null }; })()`);
const stored = (kind) => ev(`JSON.parse(localStorage.getItem("slmap:v1:${kind}:${MAP}"))`);
// Every icon must sit on its image pixel. Measured against a loaded tile, whose place in the image is known
// from its URL (z/x/y), so this does not go through js/geo.js's LatLng conversion: it catches a wrong
// projection, zoom or axis in the real Leaflet. Returns the largest distance in screen pixels.
async function iconPlacementError(label) {
  const r = await ev(`(() => {
    const tiles = [...document.querySelectorAll("img.leaflet-tile-loaded")].map((img) => {
      const [z, x, y] = img.src.match(/(\\d+)\\/(\\d+)\\/(\\d+)\\.webp$/).slice(1).map(Number);
      const b = img.getBoundingClientRect();
      // The tile grid's step on screen: tiles are drawn 1 px larger than the grid to hide the seams
      // (css/style.css), so the drawn width is scaled back to ${mapCfg.tiles.tileSize} px.
      return { z, x, y, left: b.left, top: b.top, width: b.width * ${mapCfg.tiles.tileSize} / img.offsetWidth };
    });
    const top = Math.max(...tiles.map((t) => t.z));
    const icons = ${ICONS}.map((e) => { const b = e.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; });
    return { tile: tiles.find((t) => t.z === top), icons };
  })()`);
  if (!r.tile) throw new Error(`${label}: no loaded tile`);
  equal(r.icons.length, iconPixels.length, `${label}: icons`);
  const { z, x, y, left, top, width } = r.tile;
  const span = mapCfg.tiles.tileSize * 2 ** (mapCfg.tiles.maxNativeZoom - z); // image pixels per tile
  const s = width / span;
  let worst = 0;
  for (const [px, py] of iconPixels) {
    const sx = left + (px - x * span) * s;
    const sy = top + (py - y * span) * s;
    const d = Math.min(...r.icons.map(([ix, iy]) => Math.hypot(ix - sx, iy - sy)));
    worst = Math.max(worst, d);
  }
  if (worst > 1.5) throw new Error(`${label}: an icon is ${worst.toFixed(1)} px away from its image pixel`);
  return worst;
}

// The whole popup must sit inside the map and clear of the zoom buttons.
async function popupPlacement(label) {
  await wait(700); // autopan animation
  const r = await ev(`(() => {
    const p = document.querySelector(".leaflet-popup").getBoundingClientRect();
    const m = document.getElementById("map").getBoundingClientRect();
    const z = document.querySelector(".leaflet-control-zoom").getBoundingClientRect();
    return { top: p.top - m.top, bottom: m.bottom - p.bottom, left: p.left - m.left, right: m.right - p.right,
      underZoom: !(p.top >= z.bottom || p.bottom <= z.top || p.left >= z.right || p.right <= z.left) };
  })()`);
  for (const side of ["top", "bottom", "left", "right"]) {
    if (r[side] < 0) throw new Error(`${label}: popup leaves the map on the ${side} (${r[side]} px)`);
  }
  if (r.underZoom) throw new Error(`${label}: popup under the zoom buttons`);
}

try {
  await viewport(1280, 800, false);

  await check("page loads; counters match the data", async () => {
    await freshLoad("?lang=en");
    equal(await counts(), { trial: `0/${trialTotal}`, bar: `0/${barTotal}` }, "counters");
    equal(await ev(`document.querySelector(".disclaimer")?.textContent`), ui.en["ui.disclaimer"], "disclaimer");
  });

  await check("exploration value: milestone marks, next reward and the rules behind (i)", async () => {
    const xp = () => ev(`(() => {
      const info = document.querySelector(".xp-info");
      const rules = document.getElementById(info.getAttribute("aria-controls"));
      return { marks: document.querySelectorAll(".xp-bar .xp-tick").length,
        reached: document.querySelectorAll(".xp-bar .xp-tick.reached").length,
        next: document.querySelector(".xp-next").textContent, expanded: info.getAttribute("aria-expanded"),
        open: !rules.hidden && rules.offsetHeight > 0, rows: rules.querySelectorAll("tr").length,
        first: rules.querySelector("tr")?.textContent };
    })()`);
    const tf = (key, vars) => ui.en[key].replace(/\{(\w+)\}/g, (m, k) => String(vars[k]));
    const chestRule = model.exploration.rules.find((r) => r.id === "chests");
    equal(await xp(), {
      marks: milestones.filter((m) => m <= barTotal).length, reached: 0,
      next: tf("xp.nextReward", { points: milestones[0], left: milestones[0] }), expanded: "false", open: false,
      rows: model.exploration.rules.length, first: `+${chestRule.points}${ui.en["xp.rule.chests"]}0/${chestRule.total}`,
    }, "closed");
    await ev(`document.querySelector(".xp-info").click()`);
    const open = await xp();
    equal([open.expanded, open.open], ["true", true], "after clicking (i)");
    await ev(`document.querySelector(".xp-info").click()`);
    equal((await xp()).open, false, "after clicking (i) again");
  });

  await check("?lang accepts upper-case codes", async () => {
    for (const lang of ["en", "pt", "zh"]) {
      await load(`?lang=${lang.toUpperCase()}`);
      equal(await ev(`document.documentElement.lang`), lang, `?lang=${lang.toUpperCase()}`);
    }
    equal(await ev(`document.title`), json("i18n/zh.json")["ui.title"] ?? ui.en["ui.title"], "title in zh");
  });

  // Picks a language in the top bar and waits for the page to reload in it.
  async function switchLang(code, label) {
    await ev(`(() => {
      window.__stale = true;
      const select = document.getElementById("lang-select");
      select.value = "${code}";
      select.dispatchEvent(new Event("change"));
    })()`);
    await until(`!window.__stale && document.documentElement.lang === "${code}" && document.querySelectorAll(".leaflet-marker-icon").length > 0`,
      `the page to reload in ${code} (${label})`, LOAD_WAIT, PAGE_STATE);
  }

  await check("the language selector reloads the page in the new language, with or without a hash", async () => {
    await load("?lang=en");
    await switchLang("pt", "?lang= in the address");
    equal(await ev(`location.search`), "", "?lang= dropped");
    // Opening and closing a popup leaves #<map> in the address (deep links).
    await openIcon(ICONS, 0);
    await closePopup();
    equal(await ev(`location.hash`), `#${MAP}`, "hash after closing a popup");
    await switchLang("zh", `#${MAP} in the address`);
    // With a popup open the address is #<map>/<marker>; the reload opens that marker again.
    await openIcon(ICONS, 0);
    const id = (await ev(`location.hash`)).split("/")[1];
    await switchLang("en", "a marker in the address");
    await until(`${POPUP}?.querySelector("strong")`, "the marker's popup after the reload");
    equal(await ev(`location.hash`), `#${MAP}/${id}`, "hash after the reload");
    await closePopup();
  });

  await check("every icon sits on its image pixel (fit zoom, then zoomed in)", async () => {
    // Every type on, the default-hidden ones too (by their own checkbox: "Show all" leaves them alone).
    await ev(`document.querySelector(".bulk button").click()`);
    for (const t of defaultHiddenHere) await ev(`${typeBox(t)}.checked || ${typeBox(t)}.click()`);
    const fit = await iconPlacementError("fit zoom");
    await ev(`document.querySelector(".leaflet-control-zoom-in").click()`);
    await wait(400);
    await ev(`document.querySelector(".leaflet-control-zoom-in").click()`);
    await until(`!document.querySelector(".leaflet-zoom-anim") && [...document.querySelectorAll("img.leaflet-tile")].every((t) => t.classList.contains("leaflet-tile-loaded"))`, "the zoom and its tiles", TILE_WAIT,
      `JSON.stringify({ anim: !!document.querySelector(".leaflet-zoom-anim"), tiles: document.querySelectorAll("img.leaflet-tile").length,
        waiting: [...document.querySelectorAll("img.leaflet-tile:not(.leaflet-tile-loaded)")].map((t) => [t.src, t.complete, t.naturalWidth]) })`)
      .catch((e) => {
        // Name, for each tile still waiting, whether the server ever got its request.
        const urls = [...e.message.matchAll(/"(http[^"]+\.webp)"/g)].map((m) => m[1]);
        throw new Error(`${e.message}\n${urls.map((u) => `${new URL(u).pathname}: ${servedNote(u)}`).join("\n")}`);
      });
    // Right after the zoom, Leaflet can still be swapping tile levels for a moment (seen on CI about one run
    // in three, never once settled): measure again until it passes, for up to 3 s.
    let zoomed;
    for (const started = Date.now(); ; await wait(200)) {
      try { zoomed = await iconPlacementError("zoomed in"); break; } catch (e) { if (Date.now() - started > 3000) throw e; }
    }
    console.log(`      worst offset ${fit.toFixed(2)} px at fit zoom, ${zoomed.toFixed(2)} px zoomed in`);
  });

  for (const lang of ["en", "pt"]) {
    await check(`every marker opens a popup with a real title (${lang})`, async () => {
      await load(`?lang=${lang}`);
      // In one page script: closes the open popup, clicks the next icon, reads the new popup's title.
      const titles = await ev(`(async () => {
        const titles = [];
        for (const icon of ${ICONS}) {
          document.querySelector(".leaflet-popup-close-button")?.click();
          icon.dispatchEvent(new MouseEvent("click", { bubbles: true }));
          await new Promise((r) => setTimeout(r, 0));
          titles.push(document.querySelector(".leaflet-popup .mk-popup strong")?.textContent ?? null);
        }
        document.querySelector(".leaflet-popup-close-button")?.click();
        return titles;
      })()`);
      const bad = titles.map((title, i) => [i, title])
        .filter(([, title]) => !title || /^(type|trial|field|ui)\./.test(title) || /^[a-z]+-\d{4}$/.test(title));
      if (bad.length) throw new Error(`bad titles: ${bad.map(([i, title]) => `${i}: ${title}`).join(", ")}`);
      console.log(`      ${titles.length} icons, ${new Set(titles).size} distinct titles`);
    });
  }

  // Opens a marker through the address bar, like a pasted link (the page handles hashchange).
  async function openByHash(m) {
    if (await ev(`!!document.querySelector(".leaflet-popup")`)) await closePopup();
    await ev(`location.hash = ${JSON.stringify(`#${MAP}/${m.id}`)}`);
    return until(`${POPUP}?.querySelector("strong")?.textContent`, `popup of ${m.id}`);
  }
  const hash = () => ev(`location.hash`);

  // "Only this" (js/filters.js): one category alone, "Back" to the filter from before, also after a reload;
  // a checkbox ends it and keeps what is on screen.
  await check("only this: one category alone, Back restores the filter, a checkbox ends it", async () => {
    await freshLoad("?lang=en");
    const soloOf = (types) => `document.querySelector('.solo[data-types="${types}"]')`;
    const boxOf = (types) => `${soloOf(types)}.closest(".line").querySelector("input")`;
    const shownTypes = () => ev(`[...new Set(${ICONS}.map((e) => e.querySelector("[data-type]")?.dataset.type))].sort()`);
    const bar = () => ev(`(() => { const b = document.querySelector(".solo-bar"); return b.hidden ? null : b.textContent; })()`);
    const all = await shownTypes();
    await ev(`${boxOf("divine_trial")}.click()`);
    const before = all.filter((x) => x !== "divine_trial");
    equal(await shownTypes(), before, "trials hidden by hand");
    await ev(`${soloOf("crystal")}.click()`);
    equal(await shownTypes(), ["crystal"], "only crystals");
    equal(await ev(`${soloOf("crystal")}.getAttribute("aria-pressed")`), "true", "its button is on");
    const label = json("i18n/en.json")["group.divine_mind_crystal"];
    equal(await bar(), `${json("i18n/en.json")["ui.soloShowing"]} ${label}${json("i18n/en.json")["ui.soloBack"]}`, "the bar");
    await load("?lang=en");
    equal(await shownTypes(), ["crystal"], "only crystals after a reload");
    if (!(await bar())) throw new Error("no bar after a reload");
    await ev(`document.querySelector(".solo-bar button").click()`);
    equal(await shownTypes(), before, "Back: the filter from before, after the reload too");
    equal(await bar(), null, "no bar after Back");
    await ev(`${soloOf("crystal")}.click()`);
    await ev(`${boxOf("book")}.click()`);
    equal(await shownTypes(), ["book", "crystal"], "a checkbox keeps what is on screen");
    equal(await bar(), null, "and ends it");
    await ev(`${soloOf("crystal")}.click()`);
    await ev(`${soloOf("crystal")}.click()`);
    equal(await shownTypes(), ["book", "crystal"], "a second click gives the filter back");
  });

  // Types with `defaultHidden` (categories.json): off on a first visit, "Show all" leaves them off, and once
  // turned on they stay on.
  await check("default-hidden types start hidden, Show all leaves them, turned on they stay on", async () => {
    const ids = defaultHiddenHere;
    if (!ids.length) return;
    await freshLoad("?lang=en");
    const shown = (t) => ev(`${ICONS}.some((e) => e.querySelector('[data-type="${t}"]'))`);
    const box = typeBox;
    await ev(`document.querySelector(".bulk button").click()`);
    for (const t of ids) {
      equal(await shown(t), false, `${t} off at first`);
      equal(await ev(`${box(t)}.checked`), false, `${t} unchecked`);
      await ev(`${box(t)}.click()`);
      equal(await shown(t), true, `${t} on`);
    }
    await load("?lang=en");
    for (const t of ids) equal(await shown(t), true, `${t} still on after a reload`);
  });

  // categories.json `unlockedBy` (respawned chests after the normal chests): a hint line, and a nudge once
  // the player has marked them all, whose button shows the type.
  await check("unlocked types: hint line, nudge once all are marked, its button shows them", async () => {
    const type = [...model.types.values()].find((x) => x.unlockedBy && model.types.has(x.unlockedBy));
    if (!type) return;
    const after = markers.filter((m) => m.type === type.unlockedBy).map((m) => m.id);
    const n = model.types.get(type.unlockedBy).total;
    const block = `${typeBox(type.id)}.closest(".block")`;
    await freshLoad("?lang=en");
    equal(await ev(`${block}.querySelector(".unlock-hint").textContent`), ui.en[`hint.${type.id}`].replace("{n}", n), "hint");
    equal(await ev(`${block}.querySelector(".unlock-nudge").hidden`), true, "no nudge before they are all marked");
    await ev(`localStorage.setItem("slmap:v1:progress:${MAP}", ${JSON.stringify(JSON.stringify(after))})`);
    await load("?lang=en");
    equal(await ev(`${block}.querySelector(".unlock-nudge").hidden`), false, "nudge once all are marked");
    equal(await ev(`${block}.querySelector(".unlock-nudge span").textContent`), ui.en[`nudge.${type.id}`].replace("{n}", n), "nudge text");
    await ev(`${block}.querySelector(".unlock-nudge button").click()`);
    equal(await ev(`${typeBox(type.id)}.checked`), true, "its button shows the type");
    equal(await ev(`${block}.querySelector(".unlock-nudge").hidden`), true, "and the nudge goes");
    equal(await ev(`${ICONS}.some((e) => e.querySelector('[data-type="${type.id}"]'))`), true, "on the map");
    // Once shown, it is never suggested again: not while "only this" hides it, nor when hidden by hand.
    const nudgeHidden = () => ev(`${block}.querySelector(".unlock-nudge").hidden`);
    const other = [...model.types.keys()].find((t) => t !== type.id && t !== type.unlockedBy);
    const soloOther = `document.querySelector('.solo[data-types="${other}"]:not([data-entry])')`;
    await ev(`${soloOther}.click()`);
    equal(await ev(`${typeBox(type.id)}.checked`), false, `only ${other}: the type is off`);
    equal(await nudgeHidden(), true, "no nudge during only this");
    await ev(`${soloOther}.click()`);
    await ev(`${typeBox(type.id)}.click()`);
    equal(await ev(`${typeBox(type.id)}.checked`), false, "hidden by hand");
    equal(await nudgeHidden(), true, "no nudge after hiding it again");
    await load("?lang=en");
    equal(await nudgeHidden(), true, "nor after a reload");
    // A player who had it on before the site remembered this: recorded on load.
    await freshLoad("?lang=en");
    await ev(`localStorage.setItem("slmap:v1:progress:${MAP}", ${JSON.stringify(JSON.stringify(after))})`);
    await ev(`localStorage.setItem("slmap:v1:settings", ${JSON.stringify(JSON.stringify({ hidden: { [MAP]: [] }, defaultsSeen: { [MAP]: [type.id] } }))})`);
    await load("?lang=en");
    equal(await nudgeHidden(), true, "on already: no nudge");
    await ev(`${typeBox(type.id)}.click()`);
    equal(await nudgeHidden(), true, "and none once hidden");
  });

  // "Only this" on one entry (js/filters.js canSoloEntry): only its markers, its name on the bar, kept after
  // a reload; going to another entry of the type ends it; a second click gives the filter back.
  await check("only this on an entry: only its markers, a reload keeps it, another entry ends it", async () => {
    await freshLoad("?lang=en");
    const chests = model.types.get("chest_normal");
    const [first, second] = chests.entries.filter((e) => e.size > 1);
    const block = (t) => `document.querySelector('.solo[data-types="${t}"]:not([data-entry])').closest(".block")`;
    const soloOf = (id) => `document.querySelector('.solo[data-entry="${id}"]')`;
    const shown = () => ev(`${ICONS}.map((e) => e.querySelector("[data-type]")?.dataset.type).reduce((n, t) => (n[t] = (n[t] ?? 0) + 1, n), {})`);
    const bar = () => ev(`(() => { const b = document.querySelector(".solo-bar"); return b.hidden ? null : b.querySelector("b").textContent; })()`);
    const ofEntry = (id) => markers.filter((m) => m.entry === id).length;
    const all = await shown();
    // Which entries get the button: several markers, in a type with other entries.
    for (const type of model.types.values()) {
      const expected = type.entries.length > 1 ? type.entries.filter((e) => e.size > 1).map((e) => e.id) : [];
      equal(await ev(`[...document.querySelectorAll('.solo[data-entry]')].filter((b) => b.dataset.types === "${type.id}").map((b) => b.dataset.entry)`), expected, `entry buttons of ${type.id}`);
    }
    await ev(`${block("chest_normal")}.querySelector(".expander").click()`);
    await ev(`${soloOf(first.id)}.click()`);
    equal(await shown(), { chest_normal: ofEntry(first.id) }, "only the entry's chests");
    equal(await ev(`${soloOf(first.id)}.getAttribute("aria-pressed")`), "true", "its button is on");
    const names = json(`i18n/entries.${MAP}.en.json`);
    equal(await bar(), names[first.id].name, "the bar names the entry");
    await load("?lang=en");
    equal(await shown(), { chest_normal: ofEntry(first.id) }, "the same after a reload");
    await ev(`${block("chest_normal")}.querySelector(".expander").click()`);
    await ev(`${block("chest_normal")}.querySelectorAll(".entry")[${chests.entries.indexOf(second)}].click()`);
    equal(await shown(), { chest_normal: all.chest_normal }, "another entry's name: every chest, the other types stay hidden");
    equal(await bar(), null, "and ends only this");
    await ev(`document.querySelector(".bulk button").click()`);
    const sorted = (counts) => Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
    equal(sorted(await shown()), sorted(all), "show all: what a first visit shows (not the default-hidden types)");
    await ev(`${soloOf(second.id)}.click()`);
    await ev(`${soloOf(second.id)}.click()`);
    equal(sorted(await shown()), sorted(all), "a second click gives the filter back");
  });

  // Small types list their markers one by one (js/items.js); an item opens its marker's popup.
  await check("item list: Divine Trials by short name, an item opens its trial", async () => {
    await freshLoad("?lang=pt");
    const block = `document.querySelector('.solo[data-types="divine_trial"]').closest(".block")`;
    await ev(`${block}.querySelector(".expander").click()`);
    const items = await ev(`[...${block}.querySelectorAll(".entry[data-marker]")].map((b) => [b.dataset.marker, b.querySelector(".name").textContent, b.querySelector(".count").textContent])`);
    const trialsInData = markers.filter((m) => m.type === "divine_trial");
    equal(items.map(([id]) => id), trialsInData.map((m) => m.id), "one item per trial, in the data's order");
    const names = json(`i18n/markers.${MAP}.pt.json`);
    const [firstId, firstLabel, firstCount] = items[0];
    equal(firstLabel, names[firstId].name.slice(names[firstId].name.indexOf(": ") + 2), "the name without its kind");
    equal(firstCount, `0/${trialsInData[0].stages.length}`, "its layers");
    await ev(`${block}.querySelector('.entry[data-marker="${firstId}"]').click()`);
    equal(await until(`${POPUP}?.querySelector("strong")?.textContent`, "the trial's popup"), names[firstId].name, "the popup's full name");
    await closePopup();
  });

  // The "only this" chip on the map: on a phone, only while the sidebar is closed, in each language, clear of
  // the zoom control; every category's name is measured on it (a name too long ends in "...").
  for (const lang of ["en", "pt", "zh"]) {
    await check(`only this chip (${lang}): on the map while the sidebar is closed, Back works`, async () => {
      await viewport(390, 844, true);
      await freshLoad(`?lang=${lang}`);
      const ui = { ...json("i18n/en.json"), ...json(`i18n/${lang}.json`) };
      const chipShown = () => ev(`getComputedStyle(document.querySelector(".solo-chip-lane")).display !== "none"`);
      const drawerOpen = () => ev(`!document.body.classList.contains("sidebar-hidden")`);
      if (await drawerOpen()) throw new Error("the sidebar starts open on a phone");
      equal(await chipShown(), false, "no chip before only this");
      await ev(`document.getElementById("sidebar-toggle").click()`);
      await ev(`document.querySelector('.solo[data-types="crystal"]').click()`);
      equal(await chipShown(), false, "no chip while the sidebar is open");
      await ev(`document.getElementById("sidebar-toggle").click()`);
      equal(await chipShown(), true, "the chip once the sidebar is closed");
      const name = ui["group.divine_mind_crystal"];
      equal(await ev(`document.querySelector(".solo-chip .what").textContent`), ui["ui.soloChip"].replace("{name}", name), "its text");
      equal(await ev(`document.querySelector(".solo-chip button").textContent`), ui["ui.soloBack"], "its button");
      const gap = await ev(`document.querySelector(".solo-chip").getBoundingClientRect().left - document.querySelector(".leaflet-control-zoom").getBoundingClientRect().right`);
      if (gap < 4) throw new Error(`the chip is ${gap.toFixed(1)} px from the zoom control`);
      // Every category's name on the chip: which ones end in "..." at this width.
      const cut = await ev(`(() => {
        const cut = [];
        const back = document.querySelector(".solo-chip button");
        for (const b of document.querySelectorAll(".solo:not([data-entry])")) {
          b.click();
          const what = document.querySelector(".solo-chip .what");
          if (what.scrollWidth > what.clientWidth + 1) cut.push(what.textContent);
          const chip = document.querySelector(".solo-chip").getBoundingClientRect();
          if (chip.right > innerWidth - 9) cut.push("OUTSIDE " + what.textContent);
        }
        back.click();
        return cut;
      })()`);
      if (cut.some((x) => x.startsWith("OUTSIDE"))) throw new Error(`chip past the screen edge: ${cut.join(" | ")}`);
      console.log(`      names cut short on a 390 px screen: ${cut.length ? cut.join(" | ") : "none"}`);
      await ev(`document.querySelector('.solo[data-types="crystal"]').click()`);
      await ev(`document.querySelector(".solo-chip button").click()`);
      equal(await chipShown(), false, "Back hides the chip");
      equal(await ev(`document.querySelector(".solo-bar").hidden`), true, "and ends only this");
      await shotChip(lang);
    });
  }
  await viewport(1280, 800, false);

  await check("deep link: opens the marker on load, and the address follows the open popup", async () => {
    await freshLoad("?lang=pt");
    await load(`?lang=en#${MAP}/${chest.id}`);
    equal(await until(`${POPUP}?.querySelector("strong")?.textContent`, "the linked popup"), markerTitle(chest, i18nEn), "title");
    equal(await hash(), `#${MAP}/${chest.id}`, "hash while open");
    await closePopup();
    equal(await hash(), `#${MAP}`, "hash after closing");
    await openIcon(ICONS, 5);
    if (!/^#[^/]+\/./.test(await hash())) throw new Error(`hash after opening an icon: ${await hash()}`);
    await ev(`location.hash = "#${MAP}/${MAP}-9999"`);
    await until(`location.hash === "#${MAP}"`, "an unknown id to be dropped");
    await until(`!document.querySelector(".leaflet-popup")`, "the open popup to close (it fades out)");
  });

  await check("popup extras: tags, solution, contract warning, pillar line, copy link", async () => {
    await freshLoad("?lang=en");
    equal(await openByHash(tagged), markerTitle(tagged, i18nEn), "tagged title");
    equal(await ev(`[...${POPUP}.querySelectorAll(".mk-tag")].map((e) => e.textContent)`),
      effectiveTags(tagged, entriesData).map((tag) => i18nEn.t(`tag.${tag}`)), "tags");
    await shot("popup-tags");

    await openByHash(withHowto);
    const howto = () => ev(`(() => { const b = ${POPUP}.querySelector(".howto-btn"), p = ${POPUP}.querySelector(".howto");
      return { expanded: b.getAttribute("aria-expanded"), visible: !p.hidden && p.offsetHeight > 0, text: p.textContent }; })()`);
    equal(await howto(), { expanded: "false", visible: false, text: markerNames[withHowto.id].howto }, "solution hidden");
    await ev(`${POPUP}.querySelector(".howto-btn").click()`);
    equal((await howto()).visible, true, "solution after the click");
    await shot("popup-solution");

    await openByHash(contractChest);
    equal(await ev(`[...${POPUP}.querySelectorAll("dd")].map((e) => e.textContent)`),
      [i18nEn.t(`contract.${contractChest.contract}`)], "contract name");
    equal(await ev(`${POPUP}.querySelector(".warn")?.textContent`), `⚠ ${i18nEn.t("popup.contractWarning")}`, "warning");
    await shot("popup-contract");

    await openByHash(pillarChest);
    equal(await ev(`[document.querySelectorAll(".pillar-line").length, document.querySelectorAll(".pillar-pin").length]`), [1, 1], "pillar shown");
    await ev(`navigator.clipboard.writeText = async (text) => { window.__copied = text; }`);
    await ev(`${POPUP}.querySelector(".copy-link").click()`);
    equal(await until(`window.__copied`, "the copied link"), `${BASE}#${MAP}/${pillarChest.id}`, "copied link");
    equal(await ev(`${POPUP}.querySelector(".copy-link").textContent`), `✓ ${i18nEn.t("popup.linkCopied")}`, "button after copying");
    await wait(700); // autopan
    await shot("popup-pillar");
    await closePopup();
    equal(await ev(`document.querySelectorAll(".pillar-line, .pillar-pin").length`), 0, "pillar hidden");

    // "Show on map": the popup closes and the pillar stays until the next click on the map.
    await openByHash(pillarChest);
    await ev(`${POPUP}.querySelector(".show-on-map").click()`);
    await until(`!document.querySelector(".leaflet-popup")`, "the popup to close");
    equal(await ev(`[document.querySelectorAll(".pillar-line").length, document.querySelectorAll(".pillar-pin").length]`), [1, 1], "pillar kept");
    await wait(400); // fitBounds animation
    await shot("popup-pillar-shown");
    await ev(`document.getElementById("map").dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 700, clientY: 400 }))`);
    equal(await ev(`document.querySelectorAll(".pillar-line, .pillar-pin").length`), 0, "pillar after a map click");
  });

  await check("found button: counts, saves and survives a reload", async () => {
    await freshLoad("?lang=en");
    const icons = iconsOf("chest_normal");
    await openIcon(icons, 0);
    await clickPopupButton();
    equal((await counts()).bar, `${pointsOf("chest_normal")}/${barTotal}`, "bar after marking");
    equal((await stored("progress")).length, 1, "stored ids");
    await load();
    equal((await counts()).bar, `${pointsOf("chest_normal")}/${barTotal}`, "bar after reload");
  });

  await check("marker icons: sprite per type, size per tier, contract sprite once found", async () => {
    await freshLoad("?lang=en");
    for (const t of defaultHiddenHere) await ev(`${typeBox(t)}.click()`); // their sprites too
    // The markers appear before their sprites finish loading: wait for them (a broken one fails below).
    await until(`${ICONS}.every((e) => { const i = e.querySelector(".ic-main"); return !i || (i.complete && i.naturalWidth > 0); })`,
      "the sprites to load", 5000).catch(() => {});
    // Every marker of a type with an icon shows that sprite, loaded, in its tier's box; the rest keep the dot.
    const seen = await ev(`(() => {
      const out = {};
      for (const e of ${ICONS}) {
        const box = e.querySelector("[data-type]");
        const img = box.querySelector(".ic-main");
        const o = (out[box.dataset.type] ??= { n: 0, srcs: new Set(), broken: 0, widths: new Set(), dots: 0 });
        o.n++;
        if (img) { o.srcs.add(img.getAttribute("src")); if (!img.complete || !img.naturalWidth) o.broken++; o.widths.add(e.style.width); }
        else o.dots++;
      }
      return Object.fromEntries(Object.entries(out).map(([k, o]) => [k, { ...o, srcs: [...o.srcs], widths: [...o.widths] }]));
    })()`);
    const tierPx = { common: 22, major: 38, minor: 20 };
    for (const [type, o] of Object.entries(seen)) {
      const meta = categories.types[type];
      if (!meta.icon) { equal(o.dots, o.n, `${type}: dot`); continue; }
      equal(o.srcs, [meta.icon], `${type}: sprite`);
      equal(o.broken, 0, `${type}: sprite loaded`);
      equal(o.widths, [`${meta.size ?? tierPx[meta.tier]}px`], `${type}: size`);
    }
    // The sidebar legend shows the same sprites as the map, loaded.
    const legend = await ev(`(() => { const imgs = [...document.querySelectorAll("#sidebar .dot-ic img")];
      return { srcs: [...new Set(imgs.map((i) => i.getAttribute("src")))].sort(), broken: imgs.filter((i) => !i.complete || !i.naturalWidth).length }; })()`);
    const onMap = [...new Set(Object.values(seen).flatMap((o) => o.srcs))].sort();
    equal(legend, { srcs: onMap, broken: 0 }, "sidebar legend sprites");
    // A co-op chest's badge is its number of players; challenge chests have none.
    const badges = (type) => ev(`${iconsOf(type)}.map((e) => e.querySelector(".mk-type-badge")?.textContent ?? null).sort()`);
    equal(await badges("chest_coop"), markers.filter((m) => m.type === "chest_coop").map((m) => String(m.players)).sort(), "co-op badges");
    equal([...new Set(await badges("chest_challenge"))], [null], "challenge badges");
    // The contract chest swaps to the "opened" sprite when found, as the game leaves it on its map.
    const contracts = iconsOf("chest_contract");
    const shown = () => ev(`(() => { const b = ${contracts}[0].querySelector(".mk-ic");
      return [...b.querySelectorAll("img")].filter((i) => getComputedStyle(i).display !== "none").map((i) => i.getAttribute("src")); })()`);
    equal(await shown(), [categories.types.chest_contract.icon], "contract before");
    await openIcon(contracts, 0);
    await clickPopupButton();
    equal(await shown(), [categories.types.chest_contract.iconFound], "contract once found");
    await shot("icons-found-contract");
  });

  await check("Divine Trial: layer clicks, mark all, reset, badge", async () => {
    await freshLoad("?lang=en");
    const n = longTrial.stages.length;
    const i = await openTrial(nameOf(longTrial));
    equal(await trialPopup(), { done: `0/${n}`, rows: "N" + ".".repeat(n - 1), button: ui.en["trial.completeAll"], hint: true }, "initial popup");
    equal(await clickLayer(n - 2), `${n - 2}/${n}`, "click a layer not done");
    equal(await iconState(TRIAL_ICONS, i), { found: false, badge: `${n - 2}/${n}` }, "badge");
    equal(await clickLayer(5), `4/${n}`, "click a done layer");
    equal((await trialPopup()).rows, "DDDDN" + ".".repeat(n - 5), "rows after unmarking");
    equal(await clickLayer(n), `${n}/${n}`, "click the last layer");
    equal(await clickLayer(n), `${n - 1}/${n}`, "click it again");
    equal(await clickLayer(1), `0/${n}`, "click the first done layer");
    await clickPopupButton();
    equal(await trialPopup(), { done: `${n}/${n}`, rows: "D".repeat(n), button: ui.en["trial.completed"], hint: true }, "complete");
    equal(await iconState(TRIAL_ICONS, i), { found: true, badge: null }, "complete marker");
    equal((await counts()).trial, `${n}/${trialTotal}`, "trial counter");
    equal(await stored("trials"), { [longTrial.id]: n }, "stored layers");
    await clickPopupButton();
    equal((await trialPopup()).done, `0/${n}`, "reset");
    equal(await stored("trials"), {}, "stored after reset");
  });

  await check("Divine Trial: progress survives a reload; hide found hides complete trials only", async () => {
    await freshLoad("?lang=en");
    await openTrial(nameOf(longTrial));
    await clickLayer(3);
    await load();
    equal((await counts()).trial, `3/${trialTotal}`, "after reload");
    await openTrial(nameOf(puzzle));
    await clickPopupButton();
    await closePopup();
    const before = await ev(`${TRIAL_ICONS}.length`);
    const toggle = `[...document.querySelectorAll("#sidebar label.row")].find((l) => l.textContent.trim() === ${JSON.stringify(ui.en["ui.hideFound"])}).querySelector("input")`;
    await ev(`${toggle}.click()`);
    await wait(100);
    equal(await ev(`${TRIAL_ICONS}.length`), before - 1, "icons with hide found");
    await ev(`${toggle}.click()`);
  });

  await check("old progress with a trial id is migrated to a complete trial", async () => {
    await load();
    await ev(`localStorage.clear(); localStorage.setItem("slmap:v1:progress:${MAP}", ${JSON.stringify(JSON.stringify([chest.id, puzzle.id]))})`);
    await load();
    equal(await stored("trials"), { [puzzle.id]: puzzle.stages.length }, "trials");
    equal(await stored("progress"), [chest.id], "found ids");
    equal(await counts(), { trial: `${puzzle.stages.length}/${trialTotal}`, bar: `${puzzle.stages.length * pointsOf("divine_trial") + pointsOf(chest.type)}/${barTotal}` }, "counters");
  });

  await check("backup import replaces progress and migrates trial ids", async () => {
    await freshLoad("?lang=en");
    const file = join(temp, "backup.json");
    writeFileSync(file, JSON.stringify({ app: "soul-land-map", version: 1, exportedAt: new Date(0).toISOString(),
      progress: { [MAP]: [chest.id, puzzle.id] }, trials: { [MAP]: { [longTrial.id]: 2 } } }));
    const doc = await send("DOM.getDocument");
    const input = await send("DOM.querySelector", { nodeId: doc.result.root.nodeId, selector: "#sidebar input[type=file]" });
    await send("DOM.setFileInputFiles", { nodeId: input.result.nodeId, files: [file] });
    const message = await until(`document.querySelector("#sidebar .message")?.textContent`, "the import message");
    equal(await stored("trials"), { [longTrial.id]: 2, [puzzle.id]: puzzle.stages.length }, "trials");
    equal(await stored("progress"), [chest.id], "found ids");
    // The messages count trial layers too, the backup's old trial ids included.
    const layers = 2 + puzzle.stages.length;
    equal(lastDialog, i18nEn.tf("ui.importConfirmLayers", { current: 0, currentLayers: 0, incoming: 1, incomingLayers: layers }), "confirmation");
    equal(message, i18nEn.tf("ui.importedLayers", { n: 1, layers }), "message");
  });

  // Portals are never found (categories.json `untracked`): no "Mark as found", a counter with the total only,
  // old marks dropped, and "Go to this map" opens the destination on the portal back.
  const portal = markers.find((m) => m.type === "portal" && json("data/maps.json")[m.to] && !json("data/maps.json")[m.to].draft);
  if (portal) {
    await check("portal: titled by its destination, no found button, goes to the portal back", async () => {
      await load();
      await ev(`localStorage.clear(); localStorage.setItem("slmap:v1:progress:${MAP}", ${JSON.stringify(JSON.stringify([chest.id, portal.id]))})`);
      await load();
      equal(await stored("progress"), [chest.id], "old portal mark dropped");
      const portals = markers.filter((m) => m.type === "portal").length;
      equal(await ev(`document.querySelector('.solo[data-types="portal"]:not([data-entry])').closest(".line").querySelector(".count").textContent`),
        String(portals), "portal counter: the total alone");
      equal(await openByHash(portal), i18nEn.tf("popup.portalTo", { map: i18nEn.t(`map.${portal.to}`) }), "title");
      equal(await ev(`[!!${POPUP}.querySelector(".found-btn"), ${POPUP}.querySelector(".go-btn")?.textContent]`),
        [false, `${i18nEn.t("popup.goToMap")} →`], "buttons");
      const back = json(`data/markers/${portal.to}.json`).find((m) => m.type === "portal" && m.to === MAP);
      await ev(`window.__stale = true; ${POPUP}.querySelector(".go-btn").click()`);
      await until(`!window.__stale && document.querySelector(".leaflet-popup .mk-popup strong")?.textContent`, "the destination's popup", LOAD_WAIT);
      equal(await ev(`location.hash`), `#${portal.to}/${back.id}`, "address");
      equal(await popupTitle(), i18nEn.tf("popup.portalTo", { map: i18nEn.t(`map.${MAP}`) }), "the portal back");
    });
  }
  // A portal to a map not on the site says why, with no button: not in yet, or never (Dragon Island).
  const allMapsCfg = json("data/maps.json");
  const nowheres = Object.keys(allMapsCfg).flatMap((id) => (json(`data/markers/${id}.json`) ?? [])
    .filter((m) => m.type === "portal" && !allMapsCfg[m.to]).map((m) => ({ id, m })));
  for (const nowhere of nowheres) {
    await check(`portal to a map not on the site (${nowhere.m.id}): a note, no button`, async () => {
      await ev(`window.__stale = true`);
      await send("Page.navigate", { url: `${BASE}?lang=en#${nowhere.id}/${nowhere.m.id}` });
      await until(`!window.__stale && document.querySelector(".leaflet-popup .mk-popup strong")?.textContent`, "the popup", LOAD_WAIT);
      equal(await ev(`[[...${POPUP}.querySelectorAll(".note")].at(-1)?.textContent, !!${POPUP}.querySelector(".go-btn, .found-btn")]`),
        [i18nEn.t(`popup.mapNotOnSite.${nowhere.m.to}`, i18nEn.t("popup.mapNotOnSite")), false], "note and buttons");
    });
  }

  await check("pinch zoom hides the markers until the fingers lift", async () => {
    await viewport(390, 844, true);
    await freshLoad("?lang=en");
    await ev(`new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`); // see the header
    const paneShown = () => ev(`getComputedStyle(document.querySelector(".leaflet-marker-pane")).display !== "none"`);
    // The screen distance between two markers grows with the zoom.
    const spread = () => ev(`(() => { const [a, b] = ${TRIAL_ICONS}.slice(0, 2).map((e) => e.getBoundingClientRect());
      return Math.hypot(a.x - b.x, a.y - b.y); })()`);
    const before = await spread();
    equal(await paneShown(), true, "shown before");
    // What the page got: touches on the map, and each time the pinch class came and went.
    await ev(`(() => {
      const log = window.__pinch = { start: 0, move: 0, end: 0, on: 0, off: 0 };
      const el = document.getElementById("map");
      for (const [type, key] of [["touchstart", "start"], ["touchmove", "move"], ["touchend", "end"]]) {
        el.addEventListener(type, () => log[key]++, { capture: true });
      }
      let was = false;
      new MutationObserver(() => {
        const now = el.classList.contains("mk-pinching") || !!el.querySelector(".mk-pinching");
        if (now !== was) log[now ? "on" : "off"]++;
        was = now;
      }).observe(el, { attributes: true, subtree: true, attributeFilter: ["class"] });
    })()`);
    const touch = (type, d) => send("Input.dispatchTouchEvent", { type, touchPoints: d == null ? [] :
      [{ x: 195 - d, y: 420, id: 0 }, { x: 195 + d, y: 420, id: 1 }] });
    // Leaflet applies a pinch in an animation frame, and the markers hide on the zoom it fires: wait for
    // that frame instead of looking right after the last touch (a busy page draws it late). A stalled page
    // can also drop the touches (see the header): then lift the fingers and try the gesture again.
    const paneHidden = () => until(`getComputedStyle(document.querySelector(".leaflet-marker-pane")).display === "none"`,
      "the markers to hide", 1500).then(() => true, () => false);
    for (let attempt = 1; ; attempt++) {
      await touch("touchStart", 40);
      for (let d = 50; d <= 120; d += 10) { await touch("touchMove", d); await wait(30); }
      if (await paneHidden()) break;
      if (attempt === 3) {
        throw new Error(`hidden during the pinch: the markers stayed shown in 3 attempts; the page got ${JSON.stringify(await ev("window.__pinch"))}`);
      }
      await touch("touchEnd");
      await ev(`new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`);
      await wait(300);
    }
    await touch("touchEnd");
    await until(`getComputedStyle(document.querySelector(".leaflet-marker-pane")).display !== "none"`, "markers back after the pinch");
    const after = await spread();
    if (!(after > before * 1.5)) throw new Error(`the pinch did not zoom in: ${before.toFixed(0)} -> ${after.toFixed(0)} px`);
    await viewport(1280, 800, false);
  });

  const layouts = [["desktop", 1280, 800, false], ["mobile", 390, 844, true], ["landscape", 844, 390, true]];
  for (const [name, width, height, mobile] of layouts) {
    await check(`popup of the trial nearest the top edge fits (${name})`, async () => {
      await viewport(width, height, mobile);
      await freshLoad("?lang=pt");
      await openTrial(markerNamesPt[topTrial.id]?.name);
      await popupPlacement(name);
      // Only the narrow layout (below 700 px wide) turns the popup into a bottom sheet.
      equal(await ev(`!!document.querySelector(".leaflet-popup.mk-sheet")`), name === "mobile", "popup is a sheet");
      await shot(`${name}-pt-trial`);
    });
  }

  // Where the open sheet, the selected marker and the given map layers (e.g. the pillar pin) are, in px
  // relative to the map's wrapper.
  const sheetLayout = (extra = "null") => ev(`(() => {
    const wrap = document.getElementById("map-wrap").getBoundingClientRect();
    const sheet = document.querySelector(".leaflet-popup.mk-sheet");
    const center = (e) => { const b = e.getBoundingClientRect(); return [b.left + b.width / 2 - wrap.left, b.top + b.height / 2 - wrap.top]; };
    const s = sheet?.getBoundingClientRect();
    const button = sheet?.querySelector(".mk-actions .found-btn")?.getBoundingClientRect();
    const extra = ${extra};
    return {
      width: wrap.width, height: wrap.height, inWrap: sheet?.parentElement?.id === "map-wrap",
      sheet: s && { top: s.top - wrap.top, bottom: wrap.bottom - s.bottom, left: s.left - wrap.left, right: wrap.right - s.right },
      button: button && { top: button.top - wrap.top, bottom: wrap.bottom - button.bottom },
      selected: [...document.querySelectorAll(".leaflet-marker-icon.selected")].map(center),
      extra: extra ? center(extra) : null,
      open: document.getElementById("map-wrap").classList.contains("sheet-open"),
    };
  })()`);
  // A point must sit in the map area left above the sheet.
  function aboveSheet(layout, [x, y], label) {
    if (!(x >= 0 && x <= layout.width && y >= 0 && y < layout.sheet.top)) {
      throw new Error(`${label} at ${x.toFixed(0)}, ${y.toFixed(0)} is not above the sheet (top ${layout.sheet.top.toFixed(0)})`);
    }
  }

  await check("mobile: the popup is a bottom sheet; its marker has a ring and stays in view", async () => {
    await viewport(390, 844, true);
    await freshLoad("?lang=en");
    await openTrial(nameOf(longTrial));
    await wait(700); // the pan animation
    const r = await sheetLayout();
    if (!r.inWrap) throw new Error("the sheet is not in #map-wrap");
    for (const side of ["bottom", "left", "right"]) {
      if (Math.abs(r.sheet[side]) > 1) throw new Error(`the sheet is ${r.sheet[side]} px off the ${side} edge`);
    }
    if (r.sheet.top < r.height / 2 - 1) throw new Error(`the sheet is taller than half the map (top ${r.sheet.top})`);
    if (!(r.button && r.button.top >= r.sheet.top && r.button.bottom >= 0)) {
      throw new Error(`the main button is not in view: ${JSON.stringify(r.button)}`);
    }
    equal(r.selected.length, 1, "selected markers");
    aboveSheet(r, r.selected[0], "the trial");
    equal(r.open, true, "readout hidden while the sheet is open");
    // A layer click still works inside the sheet.
    await ev(`${POPUP}.querySelectorAll(".trial-stage")[1].click()`);
    equal((await trialPopup()).done, `2/${longTrial.stages.length}`, "layers done after a click in the sheet");
    await closePopup();
    const closed = await sheetLayout();
    equal([closed.selected.length, closed.open], [0, false], "ring and sheet state after closing");
    await shot("mobile-sheet-trial");
  });

  await check("mobile: a challenge chest's sheet frames the chest and its pillar above it", async () => {
    await load(`?lang=pt#${MAP}/${pillarChest.id}`); // another query: a new hash alone would not reload
    await until(`!!document.querySelector(".leaflet-popup.mk-sheet .mk-popup")`, "the sheet");
    await wait(700);
    const r = await sheetLayout(`document.querySelector(".pillar-pin")`);
    equal(r.selected.length, 1, "selected markers");
    aboveSheet(r, r.selected[0], "the chest");
    if (!r.extra) throw new Error("no pillar pin on the map");
    aboveSheet(r, r.extra, "the pillar");
    await shot("mobile-sheet-pillar");
    await closePopup();
    await viewport(1280, 800, false);
  });

  // Every other map opens by its link with its tiles and markers. A map marked "draft" in data/maps.json is
  // listed in the region selector only while it is the current map.
  const allMaps = json("data/maps.json");
  const others = Object.keys(allMaps).filter((id) => id !== MAP);
  const mapOptions = () => ev(`[...document.querySelectorAll("#map-select option")].map((o) => o.value + (o.selected ? "*" : ""))`);
  for (const other of others) {
    const draft = !!allMaps[other].draft;
    await check(`map ${other}${draft ? " (draft)" : ""}: opens by its link, with its tiles, markers and selector`, async () => {
      await load("?lang=en");
      if (draft === (await mapOptions()).includes(other)) {
        throw new Error(`${other} is ${draft ? "" : "not "}offered on ${MAP}`);
      }
      await ev(`window.__stale = true`);
      await send("Page.navigate", { url: `${BASE}?lang=pt#${other}` });
      await until(`!window.__stale && [...document.querySelectorAll(".leaflet-tile")].some((t) => t.complete && t.naturalWidth > 0 && t.src.includes("tiles/${other}/"))`,
        `${other}'s tiles`, LOAD_WAIT);
      equal(await mapOptions(), Object.keys(allMaps).filter((id) => !allMaps[id].draft || id === other)
        .map((id) => id + (id === other ? "*" : "")), "selector");
      equal(await ev(`document.querySelector("#map-select option:checked").textContent`), json("i18n/pt.json")[`map.${other}`] ?? other, "its name");
      // One icon per point: an encounter with several points shows one on each.
      equal(await ev(`document.querySelectorAll(".leaflet-marker-icon").length`),
        (json(`data/markers/${other}.json`) ?? []).reduce((n, m) => n + (m.points?.length ?? 1), 0), "marker icons");
      // It opens on its maps.json "view" when it has one (framed on it, all of it in sight), else on the whole
      // image. What is in sight is measured in image pixels against a loaded tile, as iconPlacementError does.
      const cfg = allMaps[other];
      const seen = await ev(`(() => {
        const m = document.getElementById("map").getBoundingClientRect();
        const tiles = [...document.querySelectorAll("img.leaflet-tile-loaded")].filter((t) => t.src.includes("tiles/${other}/"));
        const img = tiles.sort((a, b) => b.src.localeCompare(a.src))[0];
        const [z, x, y] = img.src.match(/(\\d+)\\/(\\d+)\\/(\\d+)\\.webp$/).slice(1).map(Number);
        const b = img.getBoundingClientRect();
        return { z, x, y, left: b.left, top: b.top, width: b.width * ${cfg.tiles.tileSize} / img.offsetWidth,
          map: { left: m.left, top: m.top, right: m.right, bottom: m.bottom } };
      })()`);
      const span = cfg.tiles.tileSize * 2 ** (cfg.tiles.maxNativeZoom - seen.z); // image pixels per tile
      const s = seen.width / span;
      const toImage = (sx, sy) => [seen.x * span + (sx - seen.left) / s, seen.y * span + (sy - seen.top) / s];
      const [ix0, iy0] = toImage(seen.map.left, seen.map.top);
      const [ix1, iy1] = toImage(seen.map.right, seen.map.bottom);
      const v = cfg.view;
      const want = v ? [v.x, v.y, v.x + v.width, v.y + v.height] : [0, 0, cfg.image.width, cfg.image.height];
      const inSight = `in sight: ${[ix0, iy0, ix1, iy1].map((n) => n.toFixed(0)).join(", ")}; expected ${want.join(", ")}`;
      if (ix0 > want[0] + 2 || iy0 > want[1] + 2 || ix1 < want[2] - 2 || iy1 < want[3] - 2) {
        throw new Error(`the opening view does not show all of it (${inSight})`);
      }
      const room = Math.min((ix1 - ix0) / (want[2] - want[0]), (iy1 - iy0) / (want[3] - want[1]));
      if (room > 1.02) throw new Error(`the opening view is not framed on it (${inSight})`);
      await wait(500); // tiles fade in after loading
      await shot(`map-${other}`);
    });
  }

  // The site's own entries (tag "unlisted", SPEC 4.3) and badge sprites (categories.json "badgeIcon"), on the
  // first map that has them (Suotuo today).
  const mapWith = (test) => Object.keys(allMaps).find((id) => test(json(`data/entries/${id}.json`) ?? {}, json(`data/markers/${id}.json`) ?? []));
  const unlistedMap = mapWith((entries) => Object.values(entries).some((e) => e.tags?.includes("unlisted")));
  if (unlistedMap) {
    await check(`${unlistedMap}: unlisted entries come last in italics, their popup has no tag; badge sprites`, async () => {
      const entries = json(`data/entries/${unlistedMap}.json`);
      const markersOf = json(`data/markers/${unlistedMap}.json`);
      const [uid, ue] = Object.entries(entries).find(([, e]) => e.tags?.includes("unlisted"));
      const chest = markersOf.find((m) => m.entry === uid);
      await load("?lang=en");
      await load(`?lang=pt#${unlistedMap}/${chest.id}`);
      await until(`${POPUP}?.querySelector("strong")?.textContent`, "the unlisted chest's popup");
      const pt = json(`i18n/entries.${unlistedMap}.pt.json`)[uid];
      equal(await ev(`${POPUP}.querySelector("strong").textContent`), `${pt.name} #${chest.entryIndex}`, "title");
      equal(await ev(`${POPUP}.querySelector(".desc")?.textContent`), pt.description, "the site's description");
      equal(await ev(`[...${POPUP}.querySelectorAll(".mk-tag")].map((e) => e.textContent)`), [], "tags");
      await closePopup();
      // The type's entry list: the game's entries, a separator, then the site's own, in italics.
      const names = Object.entries(entries).filter(([, e]) => e.type === ue.type)
        .map(([id, e]) => [json(`i18n/entries.${unlistedMap}.pt.json`)[id].name, !!e.tags?.includes("unlisted")]);
      const want = [...names.filter(([, u]) => !u), ["—", false], ...names.filter(([, u]) => u)];
      const got = await ev(`(() => {
        const list = [...document.querySelectorAll("ul.entries")].find((ul) => ul.querySelector(".entry.unlisted"));
        return [...list.children].map((li) => li.classList.contains("entries-sep") ? ["—", false]
          : [li.querySelector(".name").textContent, getComputedStyle(li.querySelector(".name")).fontStyle === "italic"]);
      })()`);
      equal(got, want, "entry list");
      const badged = Object.keys(categories.types).filter((t) => categories.types[t].badgeIcon);
      const expected = markersOf.filter((m) => badged.includes(m.type)).length;
      if (!expected) return;
      await until(`[...document.querySelectorAll(".mk-icon-badge")].filter((i) => i.complete && i.naturalWidth > 0).length === ${expected}`,
        `${expected} badge sprites loaded`);
      // One legend badge per badged type this map has (chest_respawn, for one, is Nuoding's only).
      const badgedHere = new Set(markersOf.filter((m) => badged.includes(m.type)).map((m) => m.type)).size;
      equal(await ev(`document.querySelectorAll(".dot-ic .dot-badge").length`), badgedHere, "badges in the sidebar legend");
    });
  }

  await check("the sidebar foot shows the published version, and nothing locally", async () => {
    // Locally version.json is the committed placeholder (null fields): no line, and no 404 either.
    await load("?lang=en");
    equal(await ev(`document.querySelector(".version-line")`), null, "no version line with the placeholder");
    const sha = "565548f7283584911b7f759afe28b12153cd0b5e";
    versionJson = JSON.stringify({ commit: sha, dataDate: "2026-11-21" });
    try {
      for (const [lang, text] of [["en", "Data updated Nov 21, 2026 · 565548f"],
        ["pt", "Dados atualizados em 21 de nov. de 2026 · 565548f"], ["zh", "数据更新于 2026年11月21日 · 565548f"]]) {
        await load(`?lang=${lang}`);
        await until(`document.querySelector(".version-line")`, `the version line (${lang})`);
        equal(await ev(`document.querySelector(".version-line").textContent`), text, `version line (${lang})`);
        equal(await ev(`document.querySelector(".version-line a").href`),
          `https://github.com/gnbezerra/soul-land-map/commit/${sha}`, `commit link (${lang})`);
        // Right under the disclaimer, at the foot of the sidebar.
        equal(await ev(`document.querySelector(".version-line").previousElementSibling.className`), "disclaimer",
          `placed under the disclaimer (${lang})`);
      }
    } finally {
      versionJson = null;
    }
  });

  await check("the sidebar foot links to a new issue, filled in with the page as it is when used", async () => {
    const sha = "565548f7283584911b7f759afe28b12153cd0b5e";
    const reportHref = `document.querySelector(".report-line a").href`;
    const body = async () => new URL(await ev(reportHref)).searchParams.get("body");
    versionJson = JSON.stringify({ commit: sha, dataDate: "2026-11-21" });
    try {
      for (const lang of ["en", "pt", "zh"]) {
        const strings = { ...json("i18n/en.json"), ...json(`i18n/${lang}.json`) };
        await load(`?lang=${lang}`);
        await until(`document.querySelector(".version-line")`, `the version line (${lang})`);
        equal(await ev(`document.querySelector(".report-line").textContent`),
          strings["ui.reportLine"].replace("{link}", strings["ui.report"]), `report line (${lang})`);
        // Above the disclaimer, so it is read before the legal text.
        equal(await ev(`document.querySelector(".report-line").nextElementSibling.className`), "disclaimer",
          `placed above the disclaimer (${lang})`);
        const url = new URL(await ev(reportHref));
        equal(`${url.origin}${url.pathname}`, "https://github.com/gnbezerra/soul-land-map/issues/new", `issue form (${lang})`);
        equal(await ev(`document.querySelector(".report-line a").target`), "_blank", `new tab (${lang})`);
        const text = await body();
        for (const line of [`**${strings["ui.reportWhat"]}**`, `**${strings["ui.reportScreenshot"]}**`,
          "Version: 565548f (data 2026-11-21)", `Language: ${lang}`]) {
          if (!text.split("\n").includes(line)) throw new Error(`body (${lang}) lacks "${line}":\n${text}`);
        }
      }
      // The marker opened after the sidebar was drawn is in the body once the link is pressed (not clicked:
      // that would open a tab).
      await load(`?lang=en#${MAP}/${chest.id}`);
      await until(`${POPUP}?.querySelector("strong")`, "the linked popup");
      await closePopup();
      await openIcon(ICONS, 5);
      const opened = await hash();
      await ev(`document.querySelector(".report-line a").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))`);
      if (!(await body()).split("\n").includes(`Page: ${BASE}${opened}`)) {
        throw new Error(`body lacks the open marker ${opened}:\n${await body()}`);
      }
    } finally {
      versionJson = null;
    }
    // Locally there is no version: the body leaves that line out.
    await load("?lang=en");
    if (/^Version:/m.test(await body())) throw new Error(`a local body names a version:\n${await body()}`);
  });

  await check("no console errors or failed requests", async () => {
    // favicon and every file the site asked for loaded; nothing was logged as an error or warning
    if (pageErrors.length) throw new Error([...new Set(pageErrors)].join("\n"));
  });

  if (SHOTS) {
    for (const [name, width, height, mobile] of layouts.slice(0, 2)) {
      await viewport(width, height, mobile);
      for (const lang of ["en", "pt", "zh"]) {
        await load(`?lang=${lang}`);
        if (mobile) await ev(`document.getElementById("sidebar-toggle").click()`);
        await wait(300);
        await shot(`${name}-${lang}`);
      }
    }
    console.log(`screenshots in ${SHOTS}`);
  }
} finally {
  ws.close();
  chrome.kill();
  server.close();
  await wait(300);
  try { rmSync(temp, { recursive: true, force: true }); } catch { /* Chrome may still hold files on Windows */ }
}

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
