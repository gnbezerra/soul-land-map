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
- Never edit generated files by hand (`data/markers/*.json`, `data/entries/*.json`, `i18n/entries.*`). Edit
  `data/src/<map>/*.csv`, then run `python tools/build_data.py <map>`; it must pass before you finish.
- Do not change `data/maps.json` calibration offsets or the owner's CSV data without asking.
- UI strings: add the key to `i18n/en.json` first, then pt and zh. Official game terms vs unofficial UI
  translations are described in the README. Missing keys fall back to English.

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
- `python tools/build_data.py nuoding --check` validates data without writing.
- Tiles and `vendor/leaflet` are committed (GitHub Pages serves the repo as is). Map images under `maps/`
  are not: never commit them. Regenerate tiles only when a map image changes; see README "Running it".
- Real Leaflet behavior (zoom, popups, touch) must be checked in a real browser. If you test with a Leaflet
  stub, say so explicitly.
