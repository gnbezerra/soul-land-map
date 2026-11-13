# Soul Land Map: step 1 (map, tiles and calibration)

Everything needed to view the Nuoding map with tiles and to validate the calibration.
There are no filters, categories, popups or i18n yet.

## Running it

1. `pip install pillow`
2. Tiles (341 files, ~5 MB for a 4096x4096 image):
   `python tools/make_tiles.py path/to/nuoding.png tiles/nuoding`
3. Vendored Leaflet 1.9.4 (Leaflet's PNG images are not needed for now):
   ```
   mkdir -p vendor/leaflet
   curl -L https://unpkg.com/leaflet@1.9.4/dist/leaflet.js  -o vendor/leaflet/leaflet.js
   curl -L https://unpkg.com/leaflet@1.9.4/dist/leaflet.css -o vendor/leaflet/leaflet.css
   ```
4. `python -m http.server 8000` and open http://localhost:8000

## Calibration

`data/maps.json` has `scaleX = 25/7` and `scaleY = -25/7` (game Y grows upwards, image pixel
Y grows downwards) and `offsetX` / `offsetY` set to `null`. Replace them with the values from
your own equations.

- While they are `null`, the readout in the bottom-left corner shows image pixels only, and a
  click pins the reading (it is also logged to the console).
- To check your ~10 known points, fill `data/calibration/nuoding.json` with
  `{"x": ..., "y": ..., "px": ..., "py": ...}` (game coordinates and the observed pixel), then run
  `python tools/check_calibration.py data/maps.json nuoding data/calibration/nuoding.json`.
  It prints the least-squares fit and each point's error in pixels.
- Then put 2 or 3 known chests in `data/markers/nuoding.json`
  (`{"id": "nuoding-0001", "x": 123.4, "y": 567.8}`) and check they land exactly on the chest.

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
| `id` | yes | lowercase slug, e.g. `nuoding-academy-1` |
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
