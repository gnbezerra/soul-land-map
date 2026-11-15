// Browser test: drives a headless Chrome over the DevTools protocol against the real site (real
// vendored Leaflet). Dependency-free: Node's built-in fetch and WebSocket, plus a small static server.
//
//   node tests/browser.mjs                    run the checks
//   node tests/browser.mjs --shots <dir>      also save desktop and mobile screenshots
//   CHROME=<path> node tests/browser.mjs      use another Chrome or Chromium binary
//
// It is not part of `node --test tests/` (slower, needs Chrome). Expected values come from the generated
// data and js/model.js, so adding markers does not break it. Exit code 1 if a check fails.
// Not covered: real wheel, pinch and double-click zoom (synthetic input does not zoom headless Chrome).
//
// Gotchas when extending it:
// - Navigating to the URL already open, or to one that differs only in the hash, does not reload the
//   page. Use load(), which reloads in that case and waits for the new document.
// - Click marker icons with dispatchEvent (they may be off screen), and wait for each popup to appear
//   instead of sleeping a fixed time.
// - Popups pan into view with an animation: wait for it before measuring a popup's position.
// - Chrome's first start on a fresh machine (a CI runner) can take over 10 s: keep the startup waits generous.
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
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const json = (path) => JSON.parse(readFileSync(join(ROOT, path), "utf8"));

// --- Expected values, from the data ------------------------------------------------------------
const categories = json("data/categories.json");
const markers = json(`data/markers/${MAP}.json`);
const model = buildModel(categories, json(`data/entries/${MAP}.json`), markers);
const ui = { en: json("i18n/en.json"), pt: json("i18n/pt.json") };
const markerNames = json(`i18n/markers.${MAP}.en.json`);
const markerNamesPt = json(`i18n/markers.${MAP}.pt.json`);
const trialColor = categories.types.divine_trial.color;
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
const server = createServer((req, res) => {
  const path = normalize(join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname)));
  const file = path.endsWith(sep) ? join(path, "index.html") : path;
  if (!file.startsWith(ROOT) || !existsSync(file)) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" });
  res.end(readFileSync(file));
});
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
// Polls a page expression until it is truthy.
async function until(expression, label, timeout = 3000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await ev(expression);
    if (value) return value;
    await wait(30);
  }
  throw new Error(`timed out waiting for ${label}`);
}
await send("Runtime.enable");
await send("Network.enable");
await send("Page.enable");
await send("DOM.enable");

// --- Checks -------------------------------------------------------------------------------------
let failures = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`ok    ${name}`);
  } catch (error) {
    failures++;
    console.log(`FAIL  ${name}\n      ${error.message.split("\n").join("\n      ")}`);
  }
}
function equal(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}: expected ${e}, got ${a}`);
}

async function viewport(width, height, mobile) {
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 2, mobile });
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
  await until(`!window.__stale && document.querySelectorAll(".leaflet-marker-icon").length > 0 && !!document.querySelector(".exploration .count")`, "the map", 10000);
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

const ICONS = `[...document.querySelectorAll(".leaflet-marker-icon")]`;
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
  const row = [...document.querySelectorAll("#sidebar .row")].find((r) => r.querySelector(".dot")?.style.background && getComputedStyle(r.querySelector(".dot")).backgroundColor === (() => { const d = document.createElement("i"); d.style.color = "${trialColor}"; document.body.append(d); const c = getComputedStyle(d).color; d.remove(); return c; })());
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
      return { z, x, y, left: b.left, top: b.top, width: b.width };
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

  await check("every icon sits on its image pixel (fit zoom, then zoomed in)", async () => {
    const fit = await iconPlacementError("fit zoom");
    await ev(`document.querySelector(".leaflet-control-zoom-in").click()`);
    await wait(400);
    await ev(`document.querySelector(".leaflet-control-zoom-in").click()`);
    await until(`!document.querySelector(".leaflet-zoom-anim") && [...document.querySelectorAll("img.leaflet-tile")].every((t) => t.classList.contains("leaflet-tile-loaded"))`, "the zoom and its tiles", 5000);
    await wait(300);
    const zoomed = await iconPlacementError("zoomed in");
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
      equal(o.widths, [`${tierPx[meta.tier]}px`], `${type}: size`);
    }
    // A co-op chest's badge is its number of players; a challenge chest's is the fixed text.
    const badges = (type) => ev(`${iconsOf(type)}.map((e) => e.querySelector(".mk-type-badge")?.textContent ?? null).sort()`);
    equal(await badges("chest_coop"), markers.filter((m) => m.type === "chest_coop").map((m) => String(m.players)).sort(), "co-op badges");
    equal(new Set(await badges("chest_challenge")).size === 1 && (await badges("chest_challenge"))[0],
      categories.types.chest_challenge.badge, "challenge badges");
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

  const layouts = [["desktop", 1280, 800, false], ["mobile", 390, 844, true], ["landscape", 844, 390, true]];
  for (const [name, width, height, mobile] of layouts) {
    await check(`popup of the trial nearest the top edge fits (${name})`, async () => {
      await viewport(width, height, mobile);
      await freshLoad("?lang=pt");
      await openTrial(markerNamesPt[topTrial.id]?.name);
      await popupPlacement(name);
      await shot(`${name}-pt-trial`);
    });
  }

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
