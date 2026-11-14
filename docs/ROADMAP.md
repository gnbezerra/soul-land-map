# Roadmap and handoff

Read order for a new agent: `README.md` (run it, data pipeline) → `CLAUDE.md` (conventions) →
`docs/SPEC.md` (design) → this file (state and next steps). Last updated: 2026-11-14.

## Current state

Working, and verified by the owner in a real browser (Chrome, DevTools mobile emulation included):

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
- Progress per map in localStorage; settings (language, map, hidden types, hide-found) saved.
- i18n: en/pt/zh UI, top-bar language selector, English fallback per key.
- Responsive: drawer sidebar under 700 px, touch-sized targets, pinch zoom.

How it was tested: early work was built in a sandbox without network, against a minimal Leaflet stub, with node
unit tests for `model.js` and `storage.js`; real-Leaflet behavior was verified manually by the owner. Since
then, changes are checked on the owner's machine with `node --check js/*.js` and a headless Chrome driven over
the DevTools protocol by a dependency-free Node script (real vendored Leaflet): it clicks every marker, reads
the popup titles in en and pt, collects console errors and failed requests, and takes desktop and mobile
screenshots. These scripts are scratch files, not in the repo; adding them under `tools/` is an open option.

## Next steps (suggested order)

1. **Deploy to GitHub Pages** (the disclaimer and the favicon are in place, see SPEC §10). The repo is already
   public at <https://github.com/gnbezerra/soul-land-map>; Pages is not enabled yet (the owner turns it on in the
   repo settings, serving `main` from the root).
2. **Divine Trial UI.** Data and validation are done. Left: popup stage list (stars, level, CP when known),
   integer progress control (`trials` in the progress store; bump the storage version only if the format
   breaks), badge on the marker, counter by stage (sum of stages, 65 in Nuoding; today the bar counts each
   trial once, 333 instead of 388).
3. **Real icons.** The colored circles are a temporary placeholder to test the site; the real marker design is
   still to be discussed with the owner. Owner supplies the game's small map-marker sprites; write a Pillow
   script in `tools/` that crops/resizes to 48–64 px and outputs WebP/PNG into `icons/`; reference them from
   `data/categories.json`.
   Then settle marker sizes per zoom (SPEC §12): at the whole-map zoom the markers overlap heavily (some
   books sit under chests), especially on mobile.
4. **Exploration value in points** with reward milestones (formula and milestones in SPEC §11). Needs the PT and
   EN text of the game's rules popup. Currently the bar counts markers; the "Exploration Value" label is
   inferred and should be confirmed against the official wording.
5. **Popup extras**: "show solution" button for `howto` (texts already in `marker_texts.csv`), tags in the
   popup and sidebar (data already carried), `links` between related markers, the contract-consumed warning
   on `chest_contract`, pillar line for `chest_challenge`, deep links, copy-link, bottom-sheet popup on mobile.
6. **Rewards/items/loot** (SPEC §4.8), popup rewards with icons.
7. **Other regions**, one at a time, each needing a map image, tiles, calibration points (~10), `maps.json`
   entry, and CSVs. Region ids/names still to be fixed with the owner. Suotuo first (Nuoding already has a
   portal to it).
8. Dragon Island (Combat/Safe toggle, species filter) last.

## Waiting on the owner

- Recommended CP of the combat trial stages. It needs a new character leveled to each stage's requirement,
  so it takes days of play. `cp` is optional in `stages.csv` meanwhile and the build lists the missing stages.
- Map images and calibration points for other regions.
- Real icon sprites.
- PT and EN text of the exploration rules popup (区域探索).
- Two Mixed Area PT descriptions that were cut off in screenshots.
- Native review of the ZH UI strings.

## Known gaps and notes

- `type.book/mechanism/portal/boss/arena` UI keys exist only in `en.json` on purpose (fallback to English).
- Unused leftover PT/ZH strings were cut off in the game UI ("Rec.", "Adicionar"); do not rely on them.
- `data/maps.json` offsets and the CSVs under `data/src/` are the owner's data: do not change without asking.
- The official PT texts are translated from Chinese and are not consistent with the English names; keep them
  as the game shows them (SPEC §5).
- Backup carries `progress` only; settings are not included.
- Mixed Area's 240 exploration points reconcile only if a seed counts +5 (unconfirmed).
- Marker scale tunables: `MARKER_SHRINK_PER_ZOOM` 0.25, `MARKER_MIN_SCALE` 0.5 in `js/layers.js`; the glyph is
  hidden below 0.65 scale.
