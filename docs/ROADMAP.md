# Roadmap and handoff

Read order for a new agent: `README.md` (run it, data pipeline) → `CLAUDE.md` (conventions) →
`docs/SPEC.md` (design) → this file (state and next steps). Last updated: 2026-11-13.

## Current state

Working, and verified by the owner in a real browser (Chrome, DevTools mobile emulation included):

- Nuoding City Area map: 4096² image in 256 px tiles (zoom 0–4, `maxZoom` 5), calibrated, coordinate readout.
- Zoom: fractional fit zoom as `minZoom`, slow wheel (`wheelPxPerZoomLevel` 120), +/- snap to multiples of 0.5.
- Data pipeline CSV → JSON (`tools/build_data.py`), with validation and id stability checks.
- Data: 100 normal chests mapped (of 264) and 49 entries (all with en/pt/zh names). Other types: no markers yet.
- Sidebar: groups/types with checkboxes and live `found/total` counters, entry lists with frame-and-highlight,
  exploration bar (count-based), hide-found toggle, backup export/import.
- Popups with title, type, description, extra fields and a "found" button. Found = gray dot with a check.
- Progress per map in localStorage; settings (language, map, hidden types, hide-found) saved.
- i18n: en/pt/zh UI, top-bar language selector, English fallback per key.
- Responsive: drawer sidebar under 700 px, touch-sized targets, pinch zoom.

How it was tested: the sandbox that built most of this has no network, so real Leaflet could not be downloaded.
Playwright/Chromium tests ran against a minimal Leaflet stub, plus node unit tests for `model.js` and
`storage.js`. Those scratch tests are not in the repo. Real-Leaflet behavior was verified manually by the owner.
An agent with network access (for example Claude Code on the owner's machine) should add real tests against the
vendored Leaflet.

## Next steps (suggested order)

1. **Commit and push** the docs, and deploy to GitHub Pages early (add the unofficial-fansite disclaimer first,
   see SPEC §10). Needs the owner's go-ahead for the public repo.
2. **Real icons.** Owner supplies the game's small map-marker sprites; write a Pillow script in `tools/` that
   crops/resizes to 48–64 px and outputs WebP/PNG into `icons/`; reference them from `data/categories.json`.
   Then settle marker sizes per zoom (SPEC §12).
3. **Divine Trials** (65 stages in Nuoding, ~10 pillars). Needs from the owner: the list with positions, subtype,
   stages (stars, level, CP, rewards) and pillar theme names (en/pt/zh). Done: names in `marker_texts.csv`, `stages.csv`,
   build validation, name in the marker title. Left: popup stage list, integer progress control (`trials` in
   the progress store; bump the storage version only if the format breaks), badge on the marker, counter by
   stage (sum of stages, 65 in Nuoding).
4. **Remaining Nuoding data**: the other 164 normal chests, 16 decryption chests, 28 crystals, 5 encounters,
   10 "Other" points. Collection flow is in SPEC §8. Checksums: 264/16/65/28/5/10.
5. **Exploration value in points** with reward milestones (formula and milestones in SPEC §11). Needs the PT and
   EN text of the game's rules popup. Currently the bar counts markers; the "Exploration Value" label is
   inferred and should be confirmed against the official wording.
6. **Rewards/items/loot** (SPEC §4.8), popup rewards with icons, deep links, copy-link, bottom-sheet popup on
   mobile, pillar line for `chest_challenge`, encounter extra points on the map, "show solution" button for
   `howto` (texts already in `marker_texts.csv`).
7. **Other regions**, one at a time, each needing a map image, tiles, calibration points (~10), `maps.json`
   entry, and CSVs. Region ids/names still to be fixed with the owner.
8. Dragon Island (Combat/Safe toggle, species filter) last.

## Waiting on the owner

- Divine Trial data (owner is collecting it).
- Map images and calibration points for other regions.
- Real icon sprites.
- PT and EN text of the exploration rules popup (区域探索).
- Official PT name of "Observation point" (currently the unofficial "Ponto de Observação").
- Two Mixed Area PT descriptions that were cut off in screenshots.
- Native review of the ZH UI strings.
- Decision to make the repo/site public.

## Known gaps and notes

- `type.book/mechanism/portal/boss/arena` UI keys exist only in `en.json` on purpose (fallback to English).
- Unused leftover PT/ZH strings were cut off in the game UI ("Rec.", "Adicionar"); do not rely on them.
- `data/maps.json` offsets and the CSVs under `data/src/` are the owner's data: do not change without asking.
- Backup carries `progress` only; settings are not included.
- Mixed Area's 240 exploration points reconcile only if a seed counts +5 (unconfirmed).
- Marker scale tunables: `MARKER_SHRINK_PER_ZOOM` 0.25, `MARKER_MIN_SCALE` 0.5 in `js/layers.js`; the glyph is
  hidden below 0.65 scale.
