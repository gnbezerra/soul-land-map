# Soul Land Map

Interactive maps with filterable markers for Soul Land: New World (unofficial fan project).

Documentation for contributors and agents: [`CLAUDE.md`](CLAUDE.md) (conventions),
[`docs/SPEC.md`](docs/SPEC.md) (design) and [`docs/ROADMAP.md`](docs/ROADMAP.md) (current state, next steps).

Current state: calibrated Nuoding map, data pipeline, filter sidebar with counters, popups, found tracking with
backup, en/pt/zh UI and a responsive layout. See the roadmap for what comes next.

## Running it

Tiles and Leaflet 1.9.4 are committed, so a fresh checkout runs as is:
`python -m http.server 8000` and open http://localhost:8000

Map images are not committed (`maps/` is ignored; only the generated tiles are published). To regenerate
the tiles after the map image changes (341 files, ~5.6 MB for a 4096x4096 image):

1. `pip install pillow`
2. `python tools/make_tiles.py maps/nuoding.png tiles/nuoding`

Regenerate tiles only when the image changes: another Pillow version may encode different bytes and bloat
the history. Leaflet lives in `vendor/leaflet` (`leaflet.js`, `leaflet.css`, `LICENSE`; its PNG images are
not needed for now). To update it, download the same files for the new version from
`https://unpkg.com/leaflet@<version>/dist/` and `https://unpkg.com/leaflet@<version>/LICENSE`.

## Calibration

`data/maps.json` holds `scaleX`/`scaleY` (±25/7; game Y grows upwards, image pixel Y grows downwards) and
`offsetX`/`offsetY` (currently 428.5714285714 and 3657.142857142 for Nuoding, RMS 0.37 px over 11 points).
A new map needs its own offsets.

- The readout in the bottom-left corner shows game coordinates; a click pins the reading (also logged to the
  console). With offsets set to `null` it shows image pixels only.
- To fit a new map, fill `data/calibration/<map>.json` with `{"x": ..., "y": ..., "px": ..., "py": ...}` (game
  coordinates and the observed pixel), then run
  `python tools/check_calibration.py data/maps.json <map> data/calibration/<map>.json`. It prints the
  least-squares fit and each point's error in pixels.
- Then check that a few known markers land exactly on their in-game positions.

## Data pipeline

The collection spreadsheet (one tab per map) is exported as UTF-8 CSV into
`data/src/<map>/markers.csv` and `data/src/<map>/entries.csv`, then:

```
python tools/build_data.py nuoding            # validate, then write the JSON files
python tools/build_data.py nuoding --check    # validate only
python tools/build_data.py nuoding --strict   # warnings also fail the build
```

It writes `data/markers/<map>.json`, `data/entries/<map>.json` and
`i18n/entries.<map>.<lang>.json`. Nothing is written when there are errors. Use a dot as the
decimal separator in the CSV.

### `markers.csv`

| Column | Required | Meaning |
|---|---|---|
| `id` | always | `<map>-0001`: unique, permanent, never reused |
| `type` | always | `chest_normal`, `chest_coop`, `chest_challenge`, `chest_contract`, `crystal`, `divine_trial`, `encounter`, `teleport`, `viewpoint`, `seed`, `mechanism`, `portal`, `book`, `boss`, `arena` |
| `x`, `y` | always | game coordinates, as shown in the game UI |
| `entry` | for chests, crystals, encounters, teleports, viewpoints and seeds | entry id, or its English name |
| `entry_index` | optional | number of the `[Location N]` link in the in-game answer |
| `subtype` | `divine_trial` | `puzzle` or `combat` |
| `players` | `chest_coop` | 2 to 4 |
| `contract` | `chest_contract` | `wood`, `flame` or `frost` |
| `pillar_x`, `pillar_y` | optional, `chest_challenge` | both or neither |
| `seed` | `seed` | number shown by the game when picking the seed up |
| `requires_seed` | `mechanism` | seed number needed to activate it |
| `species` | `boss` | e.g. `supreme-bear` |
| `to` | `portal` | destination map id |
| `links` | optional | related marker ids separated by `;` |

An encounter with several points repeats its id on several rows (the first row is the primary
point). No other type may repeat an id.

### `entries.csv`

| Column | Required | Meaning |
|---|---|---|
| `id` | yes | lowercase slug, e.g. `nuoding-academy-1`; unique within a map, not across maps |
| `type` | yes | the marker type of its members (same vocabulary as `markers.csv`) |
| `name_en` | yes | name exactly as shown in the game |
| `size` | yes | expected number of markers (the `11/11` in the game) |
| `tags` | optional | separated by `;`, e.g. `purple_demon_eye` |
| `name_pt`, `name_zh`, `desc_en`, `desc_pt`, `desc_zh` | optional | official texts |

### Checks

Errors: duplicate or malformed ids, unknown types, missing columns for a type, unknown entries,
coordinates outside the image, more markers than an entry's `size`, `entry_index` above `size` or
repeated, unknown link targets, and ids whose type changed since the last build. Warnings: entries
that are still incomplete, `entry_index` gaps, ids that disappeared since the last build, and
mechanisms and seeds that do not match.

## Filters and counters (step 2)

- `data/categories.json` defines the sidebar groups (the game's own exploration categories plus a few
  extra groups), their marker types, and each type's placeholder color and glyph. Real icons will replace
  the glyphs later.
- A group or type shows up only when the map has entries or markers for it. Checkboxes toggle visibility,
  the choice is saved per map in `localStorage` (`slmap:v1:settings`), and types missing from the saved list
  default to visible.
- Counters read `found / total in the game`: the total is the sum of the `size` of the entries of that type
  (or the number of mapped markers when a type has no entries yet). The bar at the top of the sidebar sums the
  categories with `countsForExploration`; categories with no data yet are not part of its total.
- Clicking a marker opens a popup with its name, description and a "Mark as found" button. Found markers are
  faded on the map; "Hide found markers" removes them instead. Extra popup fields (`subtype`, `players`,
  `contract`, `species`, `seed`, `requiresSeed`, `to`) appear automatically when a marker has them.
- Progress is the set of found marker ids, saved per map in `localStorage` (`slmap:v1:progress:<map>`). Ids
  are permanent, so progress survives data updates, and ids that no longer exist are ignored in the counts.
  "Export"/"Import" in the sidebar save and restore a JSON backup (`{ app, version, exportedAt, progress }`);
  importing replaces the saved progress after a confirmation.
- Entry lists (for example the chest sets) expand under their type. Clicking an entry frames and highlights
  its markers on the map, and shows the type again if it was hidden.
- UI texts live in `i18n/<lang>.json` (flat keys) and entry names in `i18n/entries.<map>.<lang>.json`.
  Missing keys fall back to English. To add a language, create `i18n/<lang>.json` with the keys of
  `i18n/en.json` and list it in `i18n/languages.json` (`{"pt": "Português"}`). Only listed languages are
  offered or auto-detected, so the UI is never half translated. Try it with `?lang=pt`.
  The top bar selector saves the choice. Game terms (category, region, entry names) are the official in-game
  texts; the site's own UI strings (filters, backup, popups) are unofficial translations, so corrections from
  native speakers are very welcome. Keys missing from a language (for example `type.book`) fall back to English.
- Entries appear in the order of the rows in `entries.csv`, so keep that order equal to the in-game list.
- Tunables: `MARKER_SHRINK_PER_ZOOM` / `MARKER_MIN_SCALE` in `js/layers.js` (marker size when zoomed out),
  `wheelPxPerZoomLevel` in `js/app.js` (wheel zoom speed), `tiles.maxZoom` in `data/maps.json`.
