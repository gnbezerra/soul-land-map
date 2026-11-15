# Roadmap and handoff

Read order for a new agent: `README.md` (run it, data pipeline) → `CLAUDE.md` (conventions) →
`docs/SPEC.md` (design) → this file (state and next steps). Last updated: 2026-11-14.

## Current state

Working, and verified by the owner in a real browser (Chrome, DevTools mobile emulation included):

- Live at <https://gnbezerra.github.io/soul-land-map/> (GitHub Pages, `main` from the root; every push to
  `main` publishes). Unofficial-fansite disclaimer in the sidebar footer, map-pin favicon.
- Nuoding City Area map: 4096² image in 256 px tiles (zoom 0–4, `maxZoom` 5), calibrated, coordinate readout.
- Zoom: fractional fit zoom as `minZoom`, slow wheel (`wheelPxPerZoomLevel` 120), +/- snap to multiples of 0.5.
- Data pipeline CSV → JSON (`tools/build_data.py`), with validation and id stability checks.
- Data: Nuoding is fully mapped. 337 markers (264 normal chests, 16 decryption chests, 10 Divine Trials with
  65 stages, 28 crystals, 5 encounters, 6 teleports, 4 viewpoints, 1 portal, 3 books) and 49 entries, all with
  en/pt/zh names. Marker names, notes and howtos in `marker_texts.csv`; marker tags (e.g. `grappling_hook`).
  The recommended CP of most combat trial stages is not collected yet (see "Waiting on the owner").
- Sidebar: groups/types with checkboxes and live `found/total` counters, entry lists with frame-and-highlight,
  exploration bar (count-based), hide-found toggle, backup export/import.
- Popups with title (own name, else entry name, else type), type, description, note, extra fields and a
  "found" button. Found = gray dot with a check. Encounters with several points show a marker on each point.
- Divine Trials: popup layer list (stars, min. level, recommended rating or "—"), click-to-set progress,
  "mark all", `4/10` badge on started trials, counters per layer (Divine Trials 65, exploration bar 388).
- Progress per map in localStorage (found ids, layers done per trial), in the backup too; settings
  (language, map, hidden types, hide-found) saved.
- i18n: en/pt/zh UI, top-bar language selector, English fallback per key.
- Responsive: drawer sidebar under 700 px, touch-sized targets, pinch zoom.

How it was tested: early work was built in a sandbox without network, against a minimal Leaflet stub, with node
unit tests for `model.js` and `storage.js`; real-Leaflet behavior was verified manually by the owner. Since
then, changes are checked on the owner's machine with `node --check js/*.js`, the unit tests in `tests/`
(`node --test tests/`, model and storage, made-up data) and `node tests/browser.mjs`, a dependency-free
headless Chrome test over the DevTools protocol (real vendored Leaflet): it clicks every marker in en and pt,
checks the found button, Divine Trial progress, reloads, migration, backup import, popup placement on
desktop/mobile/landscape and console errors, and can save screenshots. Real wheel, pinch and double-click
zoom are not covered (synthetic input does not zoom headless Chrome).

## Next steps (suggested order)

1. **Real icons.** The colored circles are a temporary placeholder to test the site; the real marker design is
   still to be discussed with the owner. Owner supplies the game's small map-marker sprites; write a Pillow
   script in `tools/` that crops/resizes to 48–64 px and outputs WebP/PNG into `icons/`; reference them from
   `data/categories.json`.
   Then settle marker sizes per zoom (SPEC §12): at the whole-map zoom the markers overlap heavily (some
   books sit under chests), especially on mobile.
2. **Exploration value in points** with reward milestones (formula, milestones and the rules popup's official
   texts in en/pt/zh in SPEC §11). Currently the bar counts markers; its label ("Exploration progress")
   should then follow the official term (EN "exploration value", PT "valor de exploração", ZH 探索值).
3. **Popup extras**: "show solution" button for `howto` (texts already in `marker_texts.csv`), tags in the
   popup and sidebar (data already carried), `links` between related markers, the contract-consumed warning
   on `chest_contract`, pillar line for `chest_challenge`, deep links, copy-link, bottom-sheet popup on mobile.
4. **Rewards/items/loot** (SPEC §4.8), popup rewards with icons, including the Divine Trial layer rewards.
5. **Other regions**, one at a time, each needing a map image, tiles, calibration points (~10), `maps.json`
   entry, and CSVs. Region ids/names still to be fixed with the owner. Suotuo first (Nuoding already has a
   portal to it).
6. Dragon Island (Combat/Safe toggle, species filter) last.

## Waiting on the owner

- Recommended CP of the combat trial stages. It needs a new character leveled to each stage's requirement,
  so it takes days of play. `cp` is optional in `stages.csv` meanwhile and the build lists the missing stages.
- Map images and calibration points for other regions.
- Real icon sprites.
- Two Mixed Area PT descriptions that were cut off in screenshots.
- Native review of the ZH UI strings.

## Proposed tooling (not decided yet)

- **CI (GitHub Actions):** on every push, run `build_data.py --check`, rebuild the data and fail if the
  committed JSON differs from the CSVs, then `node --test tests/` and `node tests/browser.mjs` (Ubuntu runners
  ship Chrome). Every push to `main` deploys, and the CSVs can be edited without an agent.
- **Pipeline tests** with Python's `unittest` in `tests/`, replacing the manual `--root <temp dir>` check.

## Known gaps and notes

- Expected `build_data.py nuoding --check` warnings today: the portal to `suotuo` (map not added yet) and
  the combat trial stages without a recommended CP yet.
- `type.book/mechanism/portal/boss/arena` UI keys exist only in `en.json` on purpose (fallback to English).
- Unused leftover PT/ZH strings were cut off in the game UI ("Rec.", "Adicionar"); do not rely on them.
- `data/maps.json` offsets and the CSVs under `data/src/` are the owner's data: do not change without asking.
- The official PT texts are translated from Chinese and are not consistent with the English names; keep them
  as the game shows them (SPEC §5).
- Backup carries `progress` and `trials`; settings are not included. The export/import messages count found
  markers only, not trial layers.
- Mixed Area's 240 exploration points reconcile only if a seed counts +5 (unconfirmed).
- Marker scale tunables: `MARKER_SHRINK_PER_ZOOM` 0.25, `MARKER_MIN_SCALE` 0.5 in `js/layers.js`; the glyph is
  hidden below 0.65 scale.
