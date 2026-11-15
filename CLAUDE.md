# CLAUDE.md

Project: **Soul Land Map**, an unofficial interactive-map fansite for *Soul Land: New World*. Static site, plain
JS ES modules, Leaflet 1.9.4 vendored, no build step. Start with `README.md`, then `docs/SPEC.md` and
`docs/ROADMAP.md` (current state and next steps).

## Conventions

- Talk to the owner in **Brazilian Portuguese**. Everything in the repo (code, comments, strings, docs, commit
  messages, error messages, `lang` attributes) is in **English**, so future contributors can read it.
- Git is the source of truth: one commit per validated step. Do not commit or push unless asked.
- No frameworks, no bundler, no CDN. Keep Leaflet vendored under `vendor/leaflet`. Avoid overengineering.
- All localStorage access goes through `js/storage.js` and is wrapped in try/catch. Keys: `slmap:v1:...`.
- Marker ids (`<map>-0001`) are permanent and never reused or renumbered. Entries are identified by (map, slug).
- Markers store game coordinates, never pixels. Conversion lives in `js/geo.js` and `data/maps.json`.
- Never edit generated files by hand (`data/markers/*.json`, `data/entries/*.json`, `i18n/entries.*`,
  `i18n/markers.*`). Edit `data/src/<map>/*.csv`, then run `python tools/build_data.py <map>`; it must pass
  before you finish.
- Do not change `data/maps.json` calibration offsets or the owner's CSV data without asking.
- UI strings: add the key to `i18n/en.json` first, then pt and zh. Official game terms vs unofficial UI
  translations are described in the README. Missing keys fall back to English.
- The owner edits the CSVs and docs in parallel. Run `git status` / `git diff` before editing and before
  committing, build on their changes and never revert them; mention them in the commit message.
- After changing the pipeline, test it on a copy of the project (`--root <scratch dir>`) with made-up valid and
  invalid rows, never on the owner's CSVs.

## Constraints

- Hosting: the site must work as plain static files on GitHub Pages or similar hosts (Vercel,
  Netlify). No server code, no required build step, relative paths only.
- Browser support: current and recent versions of Chrome, Edge, Firefox and Safari, desktop and
  mobile. Use only web features that are Baseline "widely available" (see MDN); anything newer
  needs a fallback or the owner's approval. No IE support.
- Node.js may be used locally as a dev tool (e.g. `node --check js/*.js`), but the repo has no
  `package.json`, dependencies or build step until there is a clear need.

## Run and check

- `python -m http.server 8000`, open <http://localhost:8000> (`?lang=pt` to force a language).
- `python tools/build_data.py nuoding --check` validates data without writing. The expected warnings today:
  the portal to `suotuo` (map not added yet) and combat trial stages without a recommended CP yet.
- `node --check js/<file>.js` checks JS syntax (Node is installed on the owner's machine).
- `node --test tests/` runs the unit tests (Node's built-in runner, no dependencies) for the DOM-free modules
  (`js/model.js`, `js/storage.js`). They use made-up data, not the CSVs. Keep pure logic in those modules so
  it can be tested, and add tests there instead of throwaway scripts.
- Tiles and `vendor/leaflet` are committed (GitHub Pages serves the repo as is). Map images under `maps/`
  are not: never commit them. Regenerate tiles only when a map image changes; see README "Running it".
- Real Leaflet behavior (zoom, popups, touch) must be checked in a real browser. Chrome is installed, so a
  headless Chrome driven over the DevTools protocol from a dependency-free Node script works (Node has a
  built-in `WebSocket`); keep such scripts in a scratch directory. Click icons with `dispatchEvent` and wait a
  few tens of ms between clicks, or popups lag behind. If you test with a Leaflet stub, say so explicitly, and
  say what was not covered (e.g. drag, wheel and pinch zoom).
