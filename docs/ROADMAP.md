# Roadmap and handoff

Read order for a new agent: `README.md` (run it, data pipeline) → `CLAUDE.md` (rules) →
`docs/SPEC.md` (design) → this file (state and next steps). Last updated: 2026-11-16.

## Current state

Working, and verified by the owner in a real browser (Chrome, DevTools mobile emulation included):

- Live at <https://gnbezerra.github.io/soul-land-map/> (GitHub Pages). Unofficial-fansite disclaimer in the
  sidebar footer, map-pin favicon.
- CI (`.github/workflows/ci.yml`, GitHub Actions) on every push and pull request: data validation of every
  map, committed JSON equal to a fresh build, pipeline, unit and browser tests. On `main` it then deploys the
  repo as is to Pages, so a push that fails the checks leaves the previous site up.
- Nuoding City Area map: 4096² image in 256 px tiles (zoom 0–4, `maxZoom` 5), calibrated, coordinate readout.
- Suotuo City Area: 2048² image in tiles (zoom 0–3, `maxZoom` 4), in the region selector since 2026-11-16.
  Its CSVs were exported from the game tables and completed by the owner (see "Next steps"); the
  location-specific tags and some height notes are still to come.
- Calibration of both maps from the game's `map_position` table (README "Calibration"), since 2026-11-16;
  before that, least-squares fits of points measured in-game, which it matches within 0.7 (Nuoding) and
  1.9 (Suotuo) game units.
- Zoom: fractional fit zoom as `minZoom`, slow wheel (`wheelPxPerZoomLevel` 120), +/- snap to multiples of 0.5.
- Data pipeline CSV → JSON (`tools/build_data.py`), with validation and id stability checks.
- Data: Nuoding is fully mapped. 339 markers (264 normal chests, 16 decryption chests, 10 Divine Trials with
  65 stages, 28 crystals, 5 encounters, 6 teleports, 4 viewpoints, 1 portal, 5 books) and 49 entries, all with
  en/pt/zh names. Marker names, notes and howtos in `marker_texts.csv`; marker tags (e.g. `grappling_hook`).
  Checked against the game tables on 2026-11-16 (`tools/game_data.py compare nuoding`: no differences);
  the recommended CP of the combat stages, the stars of their layers 4 and 7, two books and the official
  texts came from there. The two new books (`nuoding-0338`, `0339`) have no note yet.
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
- Responsive: drawer sidebar under 700 px, touch-sized targets, pinch zoom (markers hidden while pinching),
  popups as a bottom sheet under 700 px with an orange ring on their marker (`js/sheet.js`).

How it was tested: early work was built in a sandbox without network, against a minimal Leaflet stub, with node
unit tests for `model.js` and `storage.js`; real-Leaflet behavior was verified manually by the owner. Since
then, changes are checked on the owner's machine with the unit tests in `tests/`
(`node --test tests/`: every pure module in `js/`, made-up data), the pipeline tests
(`python -m unittest discover -s tests`: `tools/build_data.py` run on made-up CSVs, every error and warning,
outputs and deterministic rebuilds) and `node tests/browser.mjs`, a dependency-free
headless Chrome test over the DevTools protocol (real vendored Leaflet): it checks that every icon sits on
its image pixel (measured against the tiles, at two zooms), clicks every marker in en and pt,
checks the found button, Divine Trial progress, reloads, migration, backup import, popup placement on
desktop/mobile/landscape, the bottom sheet on mobile (edges, height, the marker and a pillar framed above it,
the ring), that a pinch (through Leaflet's touch handler) hides the markers until it ends,
and console errors, and can save screenshots. Real wheel and double-click zoom and the browser's native pinch
are not covered (synthetic input does not zoom headless Chrome).

## Next steps (suggested order)

Order agreed with the owner on 2026-11-15: the next region comes before rewards, because a new map helps
players more and rewards need a lot of data collected in-game.

1. **Other regions**, one at a time, each needing a map image, tiles, the calibration (from the game, with
   a few points to check it), a `maps.json` entry (as a draft until its data is in), and CSVs. Suotuo is
   listed (no longer a draft since 2026-11-16, at the owner's call). Its CSVs were exported from the game
   tables (README "Game data") and completed in-game by the owner (coop players, combat levels, seals, the
   encounters with no NPC, the pillar, portals), positions sampled in-game: 331 markers, 55 entries,
   matching every count of the game (247 normal chests with the 30 in the site's two `unlisted` entries,
   12 decryption chests with the two `chest_boss`, exploration value 3245). Next on it: the
   location-specific tags and the notes on chests at a non-obvious height (the owner, in-game), and the
   marker density at full size. Five of the eight regions' images are 2048², three are 4096²; the game
   tables have the other regions' data and calibration too.
2. **`links` in the popup**, needed by Suotuo's Ownerless Objects (SPEC §4.7): the encounter's popup lists
   its three chests (found or not, "show on map"), each chest's popup names the encounter. Needs a preview;
   it can be done while the owner collects Suotuo's data, which does not depend on it.
3. **Tags in the sidebar**, then a tag filter (e.g. only the chests that need the grappling hook; the tags
   are in the data already). Needs a preview.
4. **Rewards/items/loot** (SPEC §4.8), popup rewards with icons, including the Divine Trial layer rewards.
5. **Icon leftovers**, when they come up: sprites for `seed` (candidate `dt_icon_cz`), `mechanism` and `arena`
   when those regions arrive; sharper major icons on 2x screens if the softness shows (see "Known gaps").
6. Dragon Island (Combat/Safe toggle, species filter) last.

## Waiting on the owner

- Suotuo: location-specific tags and height notes (in-game). Map images for the regions after it.
- Notes of Nuoding's two new books.
- Two Mixed Area PT descriptions that were cut off in screenshots.
- Native review of the ZH UI strings.

## Known gaps and notes

- Expected `build_data.py --check` warnings today: none for Nuoding; for Suotuo, its portals to
  `tian-dou` and `xing-dou-forest` (Xing Dou Great Forest), maps that do not exist yet. Map ids use
  hyphens, as they go in the address (`#tian-dou`); give the new maps these ids. Proposed for the other
  regions, to confirm with the owner when each one is added (ids are permanent): `xing-dou-mixed` (Mixed
  Area of Xing Dou Forest), `sunset-forest`, `city-of-slaughter`, `dragon-island`. The image names in
  `maps/` (ignored by git) may keep underscores; only the tiles folder (`tiles/<id>`) follows the id.
- Suotuo counts 247 normal chests but its entries add up to 217: 30 chests (14 in the south-west, 16 in the
  south-east) belong to NoteIds 1109 and 1110, which have no entry and no name in the game tables. Checked
  on a 247/247 character: every entry complete, 217/217. They are in the site's `unlisted-1` and
  `unlisted-2` entries (SPEC §4.3); their names and descriptions are the site's.
- Marker size follows the tile zoom (full size from `maxNativeZoom` up), not the game's scale. Suotuo has
  1.65 image px per game unit at its native zoom against Nuoding's 3.57, so at full size its markers sit
  about 2.2 times closer together on screen. Now that Suotuo has markers, it looks crowded at the whole-map
  view; on a phone (Samsung A55, 2026-11-16) chests overlap in the city centre and the north-west, and
  one zoom step separates them. The owner chose to leave it until every region is in, so the marker scale
  is decided once for all of them; the way then is basing it (and the zooms that frame markers) on px per
  game unit instead of the native zoom.
- `maxZoom` is one step above the native zoom on 2048² images (Suotuo: 4), two on 4096² ones (Nuoding: 5),
  so the most upscaled view is 2× on both. Suotuo at 5 was a 4× blur on a phone (owner, 2026-11-16).
  Thin seams between tiles showed on the phone at the upscaled zooms; not looked into yet.
- A map with no data shows an empty sidebar and `0/0` exploration value (a new draft map, before its data).
- `type.book/mechanism/portal/boss/arena` UI keys exist only in `en.json` on purpose (fallback to English).
- Unused leftover PT/ZH strings were cut off in the game UI ("Rec.", "Adicionar"); do not rely on them.
- The official PT texts are translated from Chinese and are not consistent with the English names; keep them
  as the game shows them (SPEC §5).
- Backup carries `progress` and `trials`; settings are not included.
- Switching the language reloads the page, so the map goes back to the whole-map view (an open marker
  opens again through its deep link). The owner judged it minor (2026-11-15); keeping the view would mean
  saving and restoring it across the reload.
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
- The bottom sheet is Leaflet's popup element moved into `#map-wrap` (js/sheet.js). Leaflet keeps writing the
  floating position inline (hence `!important` in `.mk-sheet`), and its `.leaflet-container`-scoped styles
  (the close button) no longer apply there, so the sheet styles them itself. It has no grabber bar on
  purpose: it cannot be dragged. If a Leaflet update breaks it, look there first. Checked by the owner on a
  Samsung A55 (2026-11-15): framing, ring, scrolling with the button in view, pillar, closing, rotation.
- The "distinct titles" count the browser test prints for the every-marker check varies between runs (e.g.
  274 to 285): a just-closed popup stays in the page while it fades out and is sometimes read instead. Only
  the count is affected; the check itself looks at every title.
- The browser test's pinch check failed once in three runs on 2026-11-16 ("hidden during the pinch:
  expected false"), with no change to the pinch code; it passed on the reruns. Watch whether it recurs.
- The browser test's zoomed-in placement check measures again for up to 3 s: right after a zoom Leaflet can
  still be swapping tile levels (it failed about one run in three before; settled, the icons were always on
  their pixel). If it fails again, look there first.
