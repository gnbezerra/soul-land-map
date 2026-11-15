# Roadmap and handoff

Read order for a new agent: `README.md` (run it, data pipeline) → `CLAUDE.md` (rules) →
`docs/SPEC.md` (design) → this file (state and next steps). Last updated: 2026-11-15.

## Current state

Working, and verified by the owner in a real browser (Chrome, DevTools mobile emulation included):

- Live at <https://gnbezerra.github.io/soul-land-map/> (GitHub Pages). Unofficial-fansite disclaimer in the
  sidebar footer, map-pin favicon.
- CI (`.github/workflows/ci.yml`, GitHub Actions) on every push and pull request: data validation of every
  map, committed JSON equal to a fresh build, pipeline, unit and browser tests. On `main` it then deploys the
  repo as is to Pages, so a push that fails the checks leaves the previous site up.
- Nuoding City Area map: 4096² image in 256 px tiles (zoom 0–4, `maxZoom` 5), calibrated, coordinate readout.
- Zoom: fractional fit zoom as `minZoom`, slow wheel (`wheelPxPerZoomLevel` 120), +/- snap to multiples of 0.5.
- Data pipeline CSV → JSON (`tools/build_data.py`), with validation and id stability checks.
- Data: Nuoding is fully mapped. 337 markers (264 normal chests, 16 decryption chests, 10 Divine Trials with
  65 stages, 28 crystals, 5 encounters, 6 teleports, 4 viewpoints, 1 portal, 3 books) and 49 entries, all with
  en/pt/zh names. Marker names, notes and howtos in `marker_texts.csv`; marker tags (e.g. `grappling_hook`).
  The recommended CP of most combat trial stages is not collected yet (see "Waiting on the owner").
- Sidebar: groups/types with checkboxes, the marker's sprite as legend, live `found/total` counters, entry lists with frame-and-highlight,
  exploration value in points with reward milestones and the rules behind an (i) button, hide-found toggle,
  backup export/import.
- Popups with title (own name, else entry name, else type), type, tags, description, note, "show solution"
  (howto), extra fields (contract names and warning, pillar with a dashed line and "show on map") and a
  "found" button; deep links (`#map/marker`, the address bar follows the open popup) and copy-link.
- Markers: the game's own sprites (`tools/make_icons.py`, SPEC §9), sized by importance (big with a colored
  glow for what the player hunts for, small and without glow for chests and for what the game's minimap already shows;
  the thin teleport and scenic spot sprites get a larger box, 26 px, to weigh about as much as a chest);
  found = grey with a green check. Encounters with several points show a marker on each point.
- Divine Trials: popup layer list (stars, min. level, recommended rating or "—"), click-to-set progress,
  "mark all", `4/10` badge on started trials, counters per layer (Divine Trials 65; 10 points per layer in the exploration value).
- Progress per map in localStorage (found ids, layers done per trial), in the backup too; settings
  (language, map, hidden types, hide-found) saved.
- i18n: en/pt/zh UI, top-bar language selector, English fallback per key.
- Responsive: drawer sidebar under 700 px, touch-sized targets, pinch zoom (markers hidden while pinching).

How it was tested: early work was built in a sandbox without network, against a minimal Leaflet stub, with node
unit tests for `model.js` and `storage.js`; real-Leaflet behavior was verified manually by the owner. Since
then, changes are checked on the owner's machine with the unit tests in `tests/`
(`node --test tests/`: every pure module in `js/`, made-up data), the pipeline tests
(`python -m unittest discover -s tests`: `tools/build_data.py` run on made-up CSVs, every error and warning,
outputs and deterministic rebuilds) and `node tests/browser.mjs`, a dependency-free
headless Chrome test over the DevTools protocol (real vendored Leaflet): it checks that every icon sits on
its image pixel (measured against the tiles, at two zooms), clicks every marker in en and pt,
checks the found button, Divine Trial progress, reloads, migration, backup import, popup placement on
desktop/mobile/landscape, that a pinch (through Leaflet's touch handler) hides the markers until it ends,
and console errors, and can save screenshots. Real wheel and double-click zoom and the browser's native pinch
are not covered (synthetic input does not zoom headless Chrome).

## Next steps (suggested order)

Order agreed with the owner on 2026-11-15: the next region comes before rewards, because a new map helps
players more and rewards need a lot of data collected in-game.

1. **Bottom-sheet popup on mobile.** On a phone the floating popup covers much of the map and sometimes its
   own marker; a sheet at the bottom shows more text and keeps the map visible. Preview the options first.
2. **Other regions**, one at a time, each needing a map image, tiles, calibration points (~10), `maps.json`
   entry, and CSVs. Region ids/names still to be fixed with the owner. Suotuo first (Nuoding already has a
   portal to it); the site side (tiles, `maps.json`, pipeline and test changes) can start while the owner
   collects the data.
3. **Tags in the sidebar**, then a tag filter (e.g. only the chests that need the grappling hook; the tags
   are in the data already). Needs a preview. Later: `links` between related markers (none in the data yet).
4. **Rewards/items/loot** (SPEC §4.8), popup rewards with icons, including the Divine Trial layer rewards.
5. **Icon leftovers**, when they come up: sprites for `seed` (candidate `dt_icon_cz`), `mechanism` and `arena`
   when those regions arrive; sharper major icons on 2x screens if the softness shows (see "Known gaps").
6. Dragon Island (Combat/Safe toggle, species filter) last.

## Waiting on the owner

- Recommended CP of the combat trial stages. It needs a new character leveled to each stage's requirement,
  so it takes days of play. `cp` is optional in `stages.csv` meanwhile and the build lists the missing stages.
- Map images and calibration points for other regions.
- Two Mixed Area PT descriptions that were cut off in screenshots.
- Native review of the ZH UI strings.

## Known gaps and notes

- Expected `build_data.py nuoding --check` warnings today: the portal to `suotuo` (map not added yet) and
  the combat trial stages without a recommended CP yet.
- `type.book/mechanism/portal/boss/arena` UI keys exist only in `en.json` on purpose (fallback to English).
- Unused leftover PT/ZH strings were cut off in the game UI ("Rec.", "Adicionar"); do not rely on them.
- The official PT texts are translated from Chinese and are not consistent with the English names; keep them
  as the game shows them (SPEC §5).
- Backup carries `progress` and `trials`; settings are not included.
- Mixed Area's 240 exploration points reconcile only if a seed counts +5 (unconfirmed). Seeds are in no
  `explorationRules` entry until it is: add `seed` to the chests rule (or a rule of its own) once confirmed.
- Marker scale tunables: `MARKER_SHRINK_PER_ZOOM` 0.25, `MARKER_MIN_SCALE` 0.35 (at 0.5 the whole-map view on a phone was a blur of halos), `TIER_SIZE` in
  `js/layers.js`, per-type `size` in `data/categories.json`; the glyph and the icon badges are hidden below 0.65 scale.
- The source sprites are 43–57 px and the major markers are drawn at 38 px, so on 2x screens they may look
  slightly soft; the owner accepted fixing that later (sharpen or redraw larger) if it shows.
- The book's category color is grey, so its glow is faint.
- Markers are hidden while a pinch is under way. Leaflet moves every marker on each pinch frame (the +/-
  buttons and the wheel animate the whole pane once), and pinch stuttered on a mid-range phone (Samsung A55,
  2026-11-15). In headless Chrome with the CPU slowed 4x a simulated pinch took ~133 ms per frame with the
  icons, ~60 ms with the old circles and 17 ms with no markers. On the phone, dropping the CSS filters helped a
  little and hiding the markers during the pinch made it fully smooth, so the filters stay. If markers must
  stay visible while pinching, the way is drawing them on a canvas (large rewrite).
- Co-op chests show their number of players (the `players` field, 1 to 4; Nuoding has 1-player "tutorial"
  co-op chests). Challenge chests have no badge: the game has no sprite for the pillar (`dt_icon_sj` is the
  Asura Statue's).
- The browser test's zoomed-in placement check measures again for up to 3 s: right after a zoom Leaflet can
  still be swapping tile levels (it failed about one run in three before; settled, the icons were always on
  their pixel). If it fails again, look there first.
