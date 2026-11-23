# Roadmap and handoff

**This document:** where the project stands, what comes next, what waits on the owner, the known gaps, and
maintenance notes for fragile parts. Entries carry their date. **Not here:** how a feature works (SPEC; this
file names it and points there), how to edit data (`docs/DATA.md`), facts about the game
(`docs/GAME-NOTES.md`), and why one piece of code is written the way it is (a comment next to that code).
**Which document holds what:** README "Documentation".

## Current state

Everything below works and was verified by the owner in a real browser (Chrome, DevTools mobile emulation
included).

**Site.** Live at <https://gnbezerra.github.io/soul-land-map/> (GitHub Pages), deployed by CI after the
checks pass (README "CI and deploy").

**Regions.**

| Region | Image | Zooms | State |
| --- | --- | --- | --- |
| Nuoding City Area | 4096² | 0–4, `maxZoom` 5 | Fully mapped: 339 markers, 49 entries, all named in en/pt/zh, plus 150 respawned chests |
| Suotuo City Area | 2048² | 0–3, `maxZoom` 4 | Published on 2026-11-16: 331 markers, 55 entries, matching every count of the game; tags and height notes still to come |
| Xing Dou Great Forest | 2048² | 0–3, `maxZoom` 4 | Published on 2026-11-22: 64 markers, 16 entries, all from the game tables, matching every counter of the game, plus the owner's tags and portals; location-specific tags and height notes still to come |

- Nuoding was checked against the game tables on 2026-11-16 (`tools/game_data.py compare nuoding`: no
  differences). The recommended CP of the combat stages, the stars of their layers 4 and 7, two books and the
  official texts came from there. The 150 respawned chests (SPEC §4.5) came from the tables too, in 5 entries
  of the site's own; the owner checked in-game the 31 at new places and sampled the others (2026-11-21).
- Suotuo's CSVs were exported from the game tables, then completed in-game by the owner: co-op players,
  combat levels, seals, the encounters with no NPC, the pillar, the portals. Its positions were sampled
  in-game. The owner made it public on 2026-11-16.
- Xing Dou Great Forest's CSVs were exported from the game tables on 2026-11-22, combat levels included
  (`docs/DATA.md` "Game data"), then corrected by the owner: the tags of Tang Sect Chests Two and Three
  (the export read the invisible chests as `hidden`, a rule fixed in `tools/game_data.py` the same day) and
  the two portals. `compare` finds no difference. Every point is in the north-west corner, the only part of
  the map image not under fog. Its calibration comes from `map_position`, checked on 2026-11-22 against 9
  points the owner measured (`docs/DATA.md` "Calibration"). The owner checked it in production and made it
  public on 2026-11-22.
- Until 2026-11-22, `compare` reported 27 invisible Tang Sect chests of Nuoding and Suotuo as missing the
  `hidden` tag; that was the same wrong rule, and the CSVs were right.
- The counts of each region, by category: `docs/GAME-NOTES.md` "Exploration counts".
- Every map is calibrated from the game's `map_position` table (Nuoding and Suotuo since 2026-11-16, before
  that from least-squares fits of points measured in-game), and checked against points measured in-game
  (`docs/DATA.md` "Calibration").

**Features.**

- Data pipeline, CSV → JSON (`tools/build_data.py`), with validation and id stability checks; the game tables
  reader (`tools/game_data.py`). Both in `docs/DATA.md`.
- Interface (SPEC §7): sidebar with counters, entry and item lists, "Show only this", the exploration value
  with milestones, types hidden by default with a hint and a nudge; popups with tags, note, "Show solution",
  type-specific fields and "Copy link"; deep links; the game's sprites as markers, sized by importance; Divine
  Trial layers (SPEC §4.6); a bottom sheet and a drawer on phones.
- Progress and settings in localStorage, with backup export and import (SPEC §6).
- The published version under the sidebar's disclaimer: the day the data last changed and the commit (SPEC §7.1),
  since 2026-11-21.
- "Report a problem" above the sidebar's disclaimer, a new GitHub issue filled in with the open marker and the
  version (SPEC §7.1), since 2026-11-21.
- i18n: en/pt/zh UI with a language selector (SPEC §5).
- A map can open on part of its image (`view` in `data/maps.json`, SPEC §4.1), since 2026-11-22: Xing Dou
  Great Forest opens on its points, in the corner not under fog.

**Tests.** The checks in README "Checks" run on the owner's machine and in CI. The browser test drives
headless Chrome with the real vendored Leaflet and covers:

- every icon on its image pixel, measured against the tiles, at two zooms;
- each other map by its link: its tiles, markers and region selector, and the view it opens on;
- every marker's popup in en and pt, the found button and Divine Trial progress;
- reloads, the storage migration and the backup import;
- popup placement on desktop, mobile and landscape, and the bottom sheet;
- a pinch through Leaflet's touch handler;
- console errors.

Not covered: real wheel and double-click zoom and the browser's native pinch, because synthetic input does not
zoom headless Chrome. Check them by hand.

## Next steps

In this order, agreed with the owner on 2026-11-15: the next region comes before rewards, because a new map
helps players more, and rewards need a lot of data collected in-game.

1. **Other regions**, one at a time (`docs/DATA.md` "Adding a region"). Next on Suotuo: the location-specific
   tags and the notes on chests at a non-obvious height (the owner, in-game), and the marker density at full
   size ("Known gaps").
2. **`links` in the popup**, needed by Suotuo's Ownerless Objects (SPEC §4.7): the encounter's popup lists its
   three chests (found or not, with "Show on map"), and each chest's popup names the encounter. Needs a
   preview. It can be done while the owner collects Suotuo's data, which does not depend on it.
3. **Tags in the sidebar**, then a tag filter (e.g. only the chests that need the Grappling Hook; the tags are
   in the data already). Needs a preview.
4. **Rewards, items and loot** (SPEC §4.8): popup rewards with icons, including the Divine Trial layer
   rewards.
5. **Icon leftovers**, when they come up: sprites for `seed` (candidate `dt_icon_cz`), `mechanism` and
   `arena`, when those regions arrive; sharper major icons on 2x screens if the softness shows ("Known gaps").
6. **Dragon Island** (SPEC §4.9: the Combat/Safe toggle, the species filter), last.

## Waiting on the owner

| Region | What | Why |
| --- | --- | --- |
| Nuoding | which normal chests have the 2, 5 and 10 blue gem looks | the loot (`docs/GAME-NOTES.md` "Loot observed in-game") |
| Nuoding | final names of the respawned-chest entries, and a native speaker for their ZH | they are provisional |
| Nuoding | notes of the two new books (`nuoding-0338`, `0339`) | they have none |
| Suotuo | the location-specific tags and the height notes (in-game) | the tables do not have them |
| Xing Dou Great Forest | the location-specific tags and height notes | the tables do not have them |
| Mixed Area | two PT descriptions that were cut off in screenshots | for when the region is added |
| next regions | their map images | tiles (`docs/DATA.md` "Adding a region") |
| all | a native review of the ZH UI strings | they are the site's own translations |

## Known gaps

- **Expected `build_data.py --check` warnings today:** none for Nuoding. For Suotuo, its portal to
  `tian-dou`; for Xing Dou Great Forest, its portal to `xing-dou-mixed-area`: maps that do not exist yet.
- **Suotuo looks crowded at the whole-map view.** Marker size follows the tile zoom (full size from
  `maxNativeZoom` up), not the game's scale. Suotuo has 1.65 image px per game unit at its native zoom against
  Nuoding's 3.57, so at full size its markers sit about 2.2 times closer together on screen. On a phone
  (Samsung A55, 2026-11-16) chests overlap in the city centre and the north-west, and one zoom step separates
  them. The owner chose to leave it until every region is in, so the marker scale is decided once for all of
  them. The way then: base the marker scale, and the zooms that frame markers, on px per game unit instead of
  the native zoom.
- **`maxZoom` is one step above the native zoom** on every map (Nuoding 5, Suotuo 4), so the most upscaled
  view is 2×. Suotuo at 5 was a 4× blur on a phone (owner, 2026-11-16).
- **A map with no data** shows an empty sidebar and a `0/0` exploration value (a new draft map, before its
  data).
- **Some UI keys exist only in English** on purpose: `type.book`, `type.mechanism`, `type.portal`,
  `type.boss`, `type.arena` fall back to `en.json`.
- **Settings are not in the backup**, only the progress (SPEC §6).
- **Switching the language reloads the page**, so the map goes back to the whole-map view (an open marker
  opens again through its deep link). The owner judged it minor (2026-11-15); keeping the view would mean
  saving and restoring it across the reload.
- **Seeds are in no exploration rule** until their points are confirmed: the Mixed Area reconciles only if a
  seed is +5 (`docs/GAME-NOTES.md` "Exploration value"). Then add `seed` to the chests rule, or give it a rule
  of its own.
- **The Divine Trial stage total is not checked** against the game's counter, which is stored nowhere yet; the
  build only prints it (SPEC §8).
- **Major markers may look soft on 2x screens:** the source sprites are 43–57 px and major markers are drawn at
  38 px. The owner accepted fixing that later (sharpen or redraw larger) if it shows.
- **The book's glow is faint**, because its category color is grey.

## Maintenance notes

The fragile parts, and what was measured about them. The code next to each one has the short version.

### Tile seams

Seen on the owner's Samsung A55 (2026-11-16) and fixed in `css/style.css`: each tile is drawn 1 px larger than
the grid and blends normally, instead of with Leaflet's `mix-blend-mode: plus-lighter`.

- **Cause.** A tile edge that falls between device pixels (zooms of x.5; the A55's 2.8125 pixel ratio) is
  drawn half transparent on both tiles. plus-lighter adds it to what is behind: the previous zoom level, which
  Leaflet keeps for a while (light lines), or the map's background (dark lines).
- **Measured** in headless Chrome at pixel ratios 2, 2.8125 and 3, on both maps, at every 0.5 zoom step:
  lines 20–48 levels brighter or darker than their neighbours before the fix, none after.
- **Cost.** A tile's image stretches by 1/256: up to 1 CSS px at its far edge, 2 px at Suotuo's zoom 4.
- **Checked on the phone.** The dark lines at whole zooms seen on the phone did not reproduce in headless
  Chrome (GPU compositing differs). The owner checked the fix on the A55 (2026-11-17), at the buttons' whole
  zooms and at fractional pinch zooms: no seams left.
- The browser test's icon placement check measures the grid step, not the drawn width.

### Markers hidden during a pinch

Leaflet moves every marker on each pinch frame (the +/- buttons and the wheel animate the whole pane once),
and pinch stuttered on a mid-range phone (Samsung A55, 2026-11-15).

- **Measured** in headless Chrome with the CPU slowed 4x: a simulated pinch took ~133 ms per frame with the
  icons, ~60 ms with the old circles and 17 ms with no markers.
- On the phone, dropping the CSS filters helped a little, and hiding the markers during the pinch made it
  fully smooth, so the filters stay.
- If markers must stay visible while pinching, the way is drawing them on a canvas (a large rewrite).

### The bottom sheet

The sheet is Leaflet's popup element moved into `#map-wrap` (`js/sheet.js`).

- Leaflet keeps writing the floating position inline, hence the `!important` in `.mk-sheet`.
- Leaflet's `.leaflet-container`-scoped styles (the close button) no longer apply there, so the sheet styles
  them itself.
- It has no grabber bar on purpose: it cannot be dragged.
- If a Leaflet update breaks it, look there first. Checked by the owner on a Samsung A55 (2026-11-15):
  framing, ring, scrolling with the button in view, pillar, closing, rotation.

### The Pages deploy

The deploy job failed on GitHub's side on 2026-11-21 and again on 2026-11-22, with the checks green and no
change in the repo to blame.

- **Symptom.** `actions/deploy-pages` stops with "Found 0 artifact(s)": the build job uploaded the
  `github-pages` artifact, but GitHub's API did not list it yet.
- **Do not** rerun the failed job ("Re-run failed jobs"): the rerun uploads a second artifact with the same
  name next to the late one, and the deploy then fails with "Multiple artifacts named github-pages … count
  is 2".
- **Fix.** Start a fresh run on `main` (Actions → CI → Run workflow, or `gh workflow run ci.yml --ref main`),
  then check that the live `version.json` shows the pushed commit. Both times this deployed with no change.
- The failed runs stay in the history; nothing needs cleaning up. If it starts happening on most pushes, look
  at a retry in the workflow instead.

### The browser test

- It was flaky (about one run in ten) until 2026-11-16: Chrome stalls now and then for several seconds, and
  the waits were raised for it. After that, 25 full runs out of 25 passed. The causes, the fixes and how to
  debug a failing check are in the header of `tests/browser.mjs`; the zoomed-in placement check retries for up
  to 3 s, for the reason in the comment above it.
- If a check fails again, rerun it (`--only <text>`) and read the times and the page state it prints before
  changing anything.
- The "distinct titles" count that the every-marker check prints varies between runs (e.g. 274 to 285): a
  just-closed popup stays in the page while it fades out, and is sometimes read instead. Only the count is
  affected; the check itself looks at every title.
