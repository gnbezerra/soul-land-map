# Roadmap and handoff

**This document:** where the project stands, what comes next, what waits on the owner, the known gaps, and
maintenance notes for fragile parts. Entries carry their date. **Not here:** how a feature works (SPEC; this
file names it and points there), how to edit data (`docs/DATA.md`), facts about the game
(`docs/GAME-NOTES.md`), and why one piece of code is written the way it is (a comment next to that code).
**Which document holds what:** README "Documentation".

## Current state

Working, and verified by the owner in a real browser (Chrome, DevTools mobile emulation included):

- Live at <https://gnbezerra.github.io/soul-land-map/> (GitHub Pages), deployed by CI after the checks pass
  (README "Running it").
- Regions:
  - **Nuoding City Area** (4096², zooms 0–4, `maxZoom` 5): fully mapped, 339 markers and 49 entries, all with
    en/pt/zh names (the counts by category: `docs/GAME-NOTES.md` "Exploration counts"). Plus the 150 chests
    that respawn once after the 264 normal ones (`chest_respawn`, SPEC §4.5), in 5 entries of the site's own,
    from the game tables; the owner checked in-game the 31 at new places and sampled the others (2026-11-21).
    Checked against the game tables on 2026-11-16 (`tools/game_data.py compare nuoding`: no differences); the
    recommended CP of the combat stages, the stars of their layers 4 and 7, two books and the official texts
    came from there.
  - **Suotuo City Area** (2048², zooms 0–3, `maxZoom` 4): in the region selector since 2026-11-16 (no longer
    a draft, at the owner's call). Its CSVs were exported from the game tables and completed in-game by the
    owner (coop players, combat levels, seals, the encounters with no NPC, the pillar, portals), positions
    sampled in-game: 331 markers, 55 entries, matching every count of the game.
- Calibration of both maps from the game's `map_position` table since 2026-11-16 (`docs/DATA.md`
  "Calibration"); before that, least-squares fits of points measured in-game.
- Data pipeline CSV → JSON (`tools/build_data.py`) with validation and id stability checks, and the game
  tables reader (`tools/game_data.py`) (`docs/DATA.md`).
- Interface (SPEC §7): sidebar with counters, entry and item lists, "only this", the exploration value with
  milestones, types hidden by default with a hint and a nudge; popups with tags, note, "Show solution", extra
  fields and copy-link; deep links; the game's sprites as markers sized by importance; Divine Trial layers
  (SPEC §4.6); bottom sheet and drawer on phones.
- Progress and settings in localStorage, with backup export/import (SPEC §6).
- i18n: en/pt/zh UI with a language selector (SPEC §5).

How it is tested: the unit, pipeline and browser tests (README "Running it") run on the owner's machine and in
CI. The browser test drives headless Chrome with the real vendored Leaflet: every icon on its image pixel
(measured against the tiles, at two zooms), every marker's popup in en and pt, the found button, Divine Trial
progress, reloads, migration, backup import, popup placement on desktop, mobile and landscape, the bottom
sheet, a pinch through Leaflet's touch handler, and console errors. Real wheel and double-click zoom and the
browser's native pinch are not covered (synthetic input does not zoom headless Chrome): check them by hand.

## Next steps (suggested order)

Order agreed with the owner on 2026-11-15: the next region comes before rewards, because a new map helps
players more and rewards need a lot of data collected in-game.

1. **Other regions**, one at a time (`docs/DATA.md` "Adding a region"). Next on Suotuo: the
   location-specific tags and the notes on chests at a non-obvious height (the owner, in-game), and the
   marker density at full size (see "Known gaps").
2. **`links` in the popup**, needed by Suotuo's Ownerless Objects (SPEC §4.7): the encounter's popup lists
   its three chests (found or not, "show on map"), each chest's popup names the encounter. Needs a preview;
   it can be done while the owner collects Suotuo's data, which does not depend on it.
3. **Tags in the sidebar**, then a tag filter (e.g. only the chests that need the grappling hook; the tags
   are in the data already). Needs a preview.
4. **Rewards/items/loot** (SPEC §4.8), popup rewards with icons, including the Divine Trial layer rewards.
5. **Icon leftovers**, when they come up: sprites for `seed` (candidate `dt_icon_cz`), `mechanism` and `arena`
   when those regions arrive; sharper major icons on 2x screens if the softness shows (see "Known gaps").
6. Dragon Island (SPEC §4.9: Combat/Safe toggle, species filter) last.

## Waiting on the owner

- Nuoding: which normal chests have the 2, 5 and 10 blue gem looks (for the loot, `docs/GAME-NOTES.md`
  "Loot observed in-game"); names of the respawned-chest entries are provisional, and their ZH needs a native
  speaker.
- Nuoding: notes of the two new books (`nuoding-0338`, `0339`).
- Suotuo: location-specific tags and height notes (in-game). Map images for the regions after it.
- Two Mixed Area PT descriptions that were cut off in screenshots.
- Native review of the ZH UI strings.

## Known gaps

- Expected `build_data.py --check` warnings today: none for Nuoding; for Suotuo, its portals to
  `tian-dou` and `xing-dou-forest` (Xing Dou Great Forest), maps that do not exist yet.
- Marker size follows the tile zoom (full size from `maxNativeZoom` up), not the game's scale. Suotuo has
  1.65 image px per game unit at its native zoom against Nuoding's 3.57, so at full size its markers sit
  about 2.2 times closer together on screen, and it looks crowded at the whole-map view; on a phone (Samsung
  A55, 2026-11-16) chests overlap in the city centre and the north-west, and one zoom step separates them. The
  owner chose to leave it until every region is in, so the marker scale is decided once for all of them; the
  way then is basing it (and the zooms that frame markers) on px per game unit instead of the native zoom.
- `maxZoom` is one step above the native zoom on every map (Nuoding 5, Suotuo 4), so the most upscaled view is
  2×. Suotuo at 5 was a 4× blur on a phone (owner, 2026-11-16).
- A map with no data shows an empty sidebar and `0/0` exploration value (a new draft map, before its data).
- `type.book/mechanism/portal/boss/arena` UI keys exist only in `en.json` on purpose (fallback to English).
- Settings are not in the backup, only the progress (SPEC §6).
- Switching the language reloads the page, so the map goes back to the whole-map view (an open marker
  opens again through its deep link). The owner judged it minor (2026-11-15); keeping the view would mean
  saving and restoring it across the reload.
- Seeds are in no `explorationRules` entry until their points are confirmed (`docs/GAME-NOTES.md`
  "Exploration value": the Mixed Area reconciles only if a seed is +5): then add `seed` to the chests rule (or
  a rule of its own).
- The build prints the Divine Trial stage total but does not check it against the game counter, which is
  stored nowhere yet (SPEC §8).
- The source sprites are 43–57 px and the major markers are drawn at 38 px, so on 2x screens they may look
  slightly soft; the owner accepted fixing that later (sharpen or redraw larger) if it shows.
- The book's category color is grey, so its glow is faint.

## Maintenance notes

Fragile parts and what was measured about them; the code next to each has the short version.

- **Tile seams** (seen on the owner's Samsung A55, 2026-11-16), fixed in `css/style.css`: each tile is drawn
  1 px larger than the grid and blends normally, instead of Leaflet's `mix-blend-mode: plus-lighter`. Cause: a
  tile edge between device pixels (zooms of x.5; the A55's 2.8125 pixel ratio) is drawn half transparent on
  both tiles; plus-lighter adds it to what is behind, which is the previous zoom level that Leaflet keeps for a
  while (light lines) or the map's background (dark lines). Measured in headless Chrome at pixel ratios 2,
  2.8125 and 3 on both maps, every 0.5 zoom step: lines 20-48 levels brighter or darker than their neighbours
  before, none left after. Cost: a tile's image stretches by 1/256 (up to 1 CSS px at its far edge, 2 px at
  Suotuo's zoom 4). The dark lines at whole zooms seen on the phone did not reproduce in headless Chrome (GPU
  compositing differs); the owner checked the fix on the A55 (2026-11-17) at the buttons' whole zooms and at
  fractional pinch zooms: no seams left. The browser test's icon placement check measures the grid step, not
  the drawn width.
- **Markers hidden during a pinch.** Leaflet moves every marker on each pinch frame (the +/- buttons and the
  wheel animate the whole pane once), and pinch stuttered on a mid-range phone (Samsung A55, 2026-11-15). In
  headless Chrome with the CPU slowed 4x a simulated pinch took ~133 ms per frame with the icons, ~60 ms with
  the old circles and 17 ms with no markers. On the phone, dropping the CSS filters helped a little and hiding
  the markers during the pinch made it fully smooth, so the filters stay. If markers must stay visible while
  pinching, the way is drawing them on a canvas (large rewrite).
- **The bottom sheet** is Leaflet's popup element moved into `#map-wrap` (`js/sheet.js`). Leaflet keeps
  writing the floating position inline (hence `!important` in `.mk-sheet`), and its
  `.leaflet-container`-scoped styles (the close button) no longer apply there, so the sheet styles them
  itself. It has no grabber bar on purpose: it cannot be dragged. If a Leaflet update breaks it, look there
  first. Checked by the owner on a Samsung A55 (2026-11-15): framing, ring, scrolling with the button in view,
  pillar, closing, rotation.
- **The browser test** was flaky (about one run in ten) until 2026-11-16: Chrome stalls now and then for
  several seconds, and the waits were raised for it (after that, 25 full runs out of 25 passed). The causes,
  the fixes and how to debug a failing check are in the header of `tests/browser.mjs`; the zoomed-in
  placement check retries for up to 3 s for the reason in the comment above it. If a check fails again, rerun
  it (`--only <text>`) and read the times and page state it prints before changing anything.
- The "distinct titles" count the browser test prints for the every-marker check varies between runs (e.g.
  274 to 285): a just-closed popup stays in the page while it fades out and is sometimes read instead. Only
  the count is affected; the check itself looks at every title.
