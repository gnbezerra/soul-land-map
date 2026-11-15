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
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { buildModel } from "../js/model.js";

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
const barTotal = model.exploration.total;
const trials = markers.filter((m) => m.type === "divine_trial" && m.stages?.length);
const longTrial = trials.filter((m) => m.subtype === "combat").sort((a, b) => b.stages.length - a.stages.length)[0];
const puzzle = trials.find((m) => m.subtype === "puzzle");
const topTrial = [...trials].sort((a, b) => b.y - a.y)[0]; // nearest the top edge (game y grows upwards)
const chest = markers.find((m) => m.type === "chest_normal");
const nameOf = (m) => markerNames[m.id]?.name;

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

// Chrome writes the port it picked into <profile>/DevToolsActivePort.
let port;
for (let i = 0; i < 100 && !port; i++) {
  try { port = readFileSync(join(profile, "DevToolsActivePort"), "utf8").split("\n")[0]; } catch { await wait(100); }
}
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));

let nextId = 0;
const pending = new Map();
const pageErrors = [];
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
  if (m.method === "Page.javascriptDialogOpening") send("Page.handleJavaScriptDialog", { accept: true });
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
const TRIAL_ICONS = `${ICONS}.filter((e) => e.querySelector(".mk-dot")?.style.getPropertyValue("--c") === "${trialColor}")`;
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

  await check("found button: counts, saves and survives a reload", async () => {
    await freshLoad("?lang=en");
    const icons = `${ICONS}.filter((e) => e.querySelector(".mk-dot")?.style.getPropertyValue("--c") === "${categories.types.chest_normal.color}")`;
    await openIcon(icons, 0);
    await clickPopupButton();
    equal((await counts()).bar, `1/${barTotal}`, "bar after marking");
    equal((await stored("progress")).length, 1, "stored ids");
    await load();
    equal((await counts()).bar, `1/${barTotal}`, "bar after reload");
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
    equal(await counts(), { trial: `${puzzle.stages.length}/${trialTotal}`, bar: `${puzzle.stages.length + 1}/${barTotal}` }, "counters");
  });

  await check("backup import replaces progress and migrates trial ids", async () => {
    await freshLoad("?lang=en");
    const file = join(temp, "backup.json");
    writeFileSync(file, JSON.stringify({ app: "soul-land-map", version: 1, exportedAt: new Date(0).toISOString(),
      progress: { [MAP]: [chest.id, puzzle.id] }, trials: { [MAP]: { [longTrial.id]: 2 } } }));
    const doc = await send("DOM.getDocument");
    const input = await send("DOM.querySelector", { nodeId: doc.result.root.nodeId, selector: "#sidebar input[type=file]" });
    await send("DOM.setFileInputFiles", { nodeId: input.result.nodeId, files: [file] });
    await until(`document.querySelector("#sidebar .message")?.textContent`, "the import message");
    equal(await stored("trials"), { [longTrial.id]: 2, [puzzle.id]: puzzle.stages.length }, "trials");
    equal(await stored("progress"), [chest.id], "found ids");
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
