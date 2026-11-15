# Soul Land Map

Interactive maps with filterable markers for Soul Land: New World (unofficial fan project).
Live site: <https://gnbezerra.github.io/soul-land-map/>. Repository: <https://github.com/gnbezerra/soul-land-map>.

Documentation for contributors and agents: [`CLAUDE.md`](CLAUDE.md) (rules and current decisions),
[`docs/SPEC.md`](docs/SPEC.md) (design) and [`docs/ROADMAP.md`](docs/ROADMAP.md) (current state, next steps).

Current state: the Nuoding map is calibrated and fully mapped (337 markers); data pipeline, filter sidebar
with counters, popups, found tracking with backup, en/pt/zh UI and a responsive layout. See the roadmap for
what comes next.

## Running it

Tiles and Leaflet 1.9.4 are committed, so a fresh checkout runs as is:
`python -m http.server 8000` and open http://localhost:8000

Unit tests (Node's built-in runner, nothing to install): `node --test tests/`.
Pipeline tests (Python's `unittest`, made-up CSVs in a temporary directory; about 10 s):
`python -m unittest discover -s tests`.
Browser test (needs Chrome; about 15 s): `node tests/browser.mjs`, with `--shots <dir>` to save screenshots
and `CHROME=<path>` if Chrome is not in a standard place.

CI and deploy: `.github/workflows/ci.yml` runs on every push and pull request. It validates every map in
`data/maps.json`, rebuilds the data and fails if the result differs from the committed JSON, then runs the
pipeline, unit and browser tests. On `main`, and only when all of that passes, it publishes the repo as is to
GitHub Pages (Settings → Pages → Source must be "GitHub Actions"). When a browser test fails, its screenshots
are attached to the run as the `browser-shots` artifact. To redeploy without a new commit, run the workflow
by hand (Actions → CI → Run workflow) on `main`.

Map images are not committed (`maps/` is ignored; only the generated tiles are published). To regenerate
the tiles after the map image changes (341 files, ~5.6 MB for a 4096x4096 image):

1. `pip install pillow`
2. `python tools/make_tiles.py maps/nuoding.png tiles/nuoding`

Regenerate tiles only when the image changes: another Pillow version may encode different bytes and bloat
the history. Leaflet lives in `vendor/leaflet` (`leaflet.js`, `leaflet.css`, `LICENSE`; its PNG images are
not needed for now). To update it, download the same files for the new version from
`https://unpkg.com/leaflet@<version>/dist/` and `https://unpkg.com/leaflet@<version>/LICENSE`.

Marker icons (`icons/*.png`) are sprites from the game's UI atlases. To regenerate them, export each atlas
with AssetRipper ("Export project") into `maps/icons/raw/<atlas>/` (ignored, like the map images: currently
`worldmappanel`, `worlduipanel` and `commonui`) and run `python tools/make_icons.py` (Pillow). Which sprite
becomes which icon is the `ICONS` table at the top of the script; it reads each sprite's rectangle from its
`.asset` file, trims it to the drawing and centers it on a square. Like the tiles, rerun it only when a sprite
changes.

The site icon is `favicon.svg`; after changing it, update the same geometry in `tools/make_favicon.py` and
run `python tools/make_favicon.py` (Pillow) to rebuild `favicon.ico` and `apple-touch-icon.png`.

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
`data/src/<map>/markers.csv` and `data/src/<map>/entries.csv` (plus `marker_texts.csv` for
marker names, notes and howtos, and `stages.csv` for Divine Trials), then:

```
python tools/build_data.py nuoding            # validate, then write the JSON files
python tools/build_data.py nuoding --check    # validate only
python tools/build_data.py nuoding --strict   # warnings also fail the build
```

It writes `data/markers/<map>.json`, `data/entries/<map>.json`,
`i18n/entries.<map>.<lang>.json` and `i18n/markers.<map>.<lang>.json` (marker texts). Nothing
is written when there are errors. Use a dot as the decimal separator in the CSV. Only the columns
marked "always" or "yes" below must exist; any other column can be left out of a sheet when no row
uses it, and column order does not matter.

### `markers.csv`

| Column | Required | Meaning |
|---|---|---|
| `id` | always | `<map>-0001`: unique, permanent, never reused |
| `type` | always | `chest_normal`, `chest_coop`, `chest_challenge`, `chest_contract`, `crystal`, `divine_trial`, `encounter`, `teleport`, `viewpoint`, `seed`, `mechanism`, `portal`, `book`, `boss`, `arena` |
| `x`, `y` | always | game coordinates, as shown in the game UI |
| `entry` | for chests, crystals, encounters, teleports, viewpoints and seeds | entry id, or its English name |
| `entry_index` | optional | number of the `[Location N]` link in the in-game answer |
| `subtype` | `divine_trial` | `puzzle` or `combat` |
| `players` | `chest_coop`; optional for `chest_challenge` | 1 to 4; on a challenge, empty means a single player |
| `contract` | `chest_contract` | `wood`, `flame` or `frost` |
| `pillar_x`, `pillar_y` | optional, `chest_challenge` | both or neither |
| `seed` | `seed` | number shown by the game when picking the seed up |
| `requires_seed` | `mechanism` | seed number needed to activate it |
| `species` | `boss` | e.g. `supreme-bear` |
| `to` | `portal` | destination map id |
| `links` | optional | related marker ids separated by `;` |
| `tags` | optional | this marker's own requirements separated by `;`, on top of its entry's tags (e.g. `grappling_hook` on one chest of a `purple_demon_eye` entry) |

An encounter with several points repeats its id on several rows (the first row is the primary
point). Each point gets its own icon on the map, and the encounter still counts once. No other type may
repeat an id.

### `entries.csv`

| Column | Required | Meaning |
|---|---|---|
| `id` | yes | lowercase slug, e.g. `nuoding-academy-1`; unique within a map, not across maps |
| `type` | yes | the marker type of its members (same vocabulary as `markers.csv`) |
| `name_en` | yes | name exactly as shown in the game |
| `size` | yes | expected number of markers (the `11/11` in the game) |
| `tags` | optional | separated by `;`, e.g. `purple_demon_eye` |
| `name_pt`, `name_zh`, `desc_en`, `desc_pt`, `desc_zh` | optional | official texts |

### `marker_texts.csv`

Texts that belong to one marker, one row per marker and field (rows may be in any order):

| Column | Required | Meaning |
|---|---|---|
| `marker` | yes | marker id |
| `field` | yes | `name`, `note` or `howto` (see below) |
| `en` | yes | English text (the fallback for every language) |
| `pt`, `zh` | optional | translations |

- `name`: the marker's own name, only for `divine_trial`, `book`, `teleport` and `viewpoint`. It is the
  popup title and takes precedence over the entry name (other markers take their title from the entry or
  the type). Use the game's official names, except for obvious mistakes such as a stray final period.
- `note`: a short fact the player needs to find the point, always shown in the popup, e.g. "Inside the
  cave under the plains". Any marker type.
- `howto`: the solution, for things the game's description does not say, e.g. "Talk to Andy five
  times". Any marker type; it will sit behind a "show solution" button (not shown on the site yet).

```csv
marker,field,en,pt,zh
nuoding-0281,name,Trial of Strength: Shield of Stone,Provação da Força: Escudo de Pedra,力之试炼·岩之盾
nuoding-0185,note,Grapple onto the roof using the grappling hook.,Suba no telhado usando o gancho.,使用飞天神爪登上屋顶。
```

### Divine Trials: `stages.csv`

Divine Trials have no entry in the game's list. The pillar itself is a `divine_trial` row in
`markers.csv` (`id`, `x`, `y`, `subtype`), its name is a `name` row in `marker_texts.csv`, and its
stages live in `stages.csv`, one row per stage (rows may be in any order):

| Column | Required | Meaning |
|---|---|---|
| `trial` | yes | id of a `divine_trial` marker |
| `stage` | yes | 1, 2, 3... in the order the stages are played, no gaps (3 to 10 stages) |
| `stars` | yes | difficulty, 1 to 5 |
| `level` | combat trials only | level required to enter; empty for puzzle trials |
| `cp` | optional, combat trials only | recommended combat power; leave it empty while unknown (the build warns) |

```csv
trial,stage,stars,level,cp
nuoding-0281,1,1,25,12000
nuoding-0281,2,2,27,18000
nuoding-0281,3,2,29,
nuoding-0283,1,1,,
```

The third row is a combat stage whose recommended CP is not known yet; the last one is a puzzle stage.
The build adds a `stages` list (in stage order) to the marker and prints the stage total of the map,
to compare with the game's Divine Trial counter (65 in Nuoding).

### Checks

Errors:

- duplicate or malformed ids, unknown types, missing columns for a type, unknown entries, coordinates
  outside the image, unknown link targets, ids whose type changed since the last build;
- more markers than an entry's `size`, `entry_index` above `size` or repeated;
- Divine Trials with stage gaps, repeated stages, fewer than 3 or more than 10 stages, stars outside 1 to 5,
  `level` missing on a combat trial, or `level`/`cp` filled in on a puzzle one;
- marker texts with an unknown marker or field, a `name` on a type other than `divine_trial`, `book`,
  `teleport` or `viewpoint`, a repeated field, or no `en`;
- malformed or repeated tags.

Warnings:

- entries that are still incomplete, `entry_index` gaps, ids that disappeared since the last build;
- mechanisms and seeds that do not match, portals to maps not in `maps.json` yet;
- Divine Trials, books, teleports and viewpoints without a name; Divine Trials without stages; combat stages
  without a recommended CP yet; stage levels that go down;
- marker tags already on the entry.

## Site behavior

- `data/categories.json` defines the sidebar groups (the game's own exploration categories plus a few
  extra groups), their marker types, and per type: `color` (glow, pillar line, and the dot of a type with no icon), `glyph`
  (letter in the colored dot used when a type has no icon: `seed`, `mechanism`, `arena` today), `icon`
  (path in `icons/`; the sidebar shows it too), optional `iconFound` (replaces the icon once found: the opened contract chest),
  `tier`, and optional `badge` (short text on the icon's corner, for chests that share a sprite) or
  `badgeField` (the badge shows that marker field instead: a co-op chest shows its `players`, 1 to 4).
- Marker size follows the tier (`TIER_SIZE` in `js/layers.js`): `common` 22 px (chests), `major` 38 px with
  a glow in the category color (Divine Trials, crystals, encounters, books, bosses: what the player hunts
  for), `minor` 20 px (teleports, scenic spots, portals, which the game's own minimap already shows). Major
  markers are drawn above the chests. Found markers turn grey with a green check.
- A group or type shows up only when the map has entries or markers for it. Checkboxes toggle visibility,
  the choice is saved per map in `localStorage` (`slmap:v1:settings`), and types missing from the saved list
  default to visible.
- Counters read `found / total in the game`: the total is the sum of the `size` of the entries of that type
  (or the number of mapped markers when a type has no entries yet).
- The bar at the top of the sidebar is the game's exploration value, in points: `explorationRules` in
  `data/categories.json` give the points of each rule of the game's "Area Exploration" popup (e.g. every chest
  type +5, a Divine Trial +10 per layer; seeds are in no rule yet), and each rule counts its types' counters.
  Types with no data yet are not part of the total (3080 in Nuoding). The map's reward milestones
  (`exploration.milestones` in `data/maps.json`) are marks on the bar, with the next reward and the points left
  below it; the (i) button opens the rules with the official texts and the counts done of each.
- Clicking a marker opens a popup with its title (the marker's own name, else the entry name, else the type),
  the entry description, the marker's note and a "Mark as found" button. Found markers are faded on the map;
  "Hide found markers" removes them instead. Extra popup fields (`subtype`, `players`, `contract`, `pillar`,
  `species`, `seed`, `requiresSeed`, `to`) appear automatically when a marker has them; contracts show their
  official name (`contract.<code>` UI keys) and a warning that opening the chest uses the contract up.
- Popups also show the marker's tags (its entry's plus its own) as labels, with the names in `tag.<id>` UI keys
  and an optional `tag.<id>.hint` tooltip; a new tag only needs those keys (`poison_seal` and `fire_seal` are
  ready for the maps after Nuoding). A marker's howto sits behind "Show solution". A challenge chest's pillar
  is a pin tied to the chest by a dashed line while its popup is open; "Show on map" closes the popup and
  frames both, keeping the pin until the next click on the map.
- Deep links: `#<map>/<marker id>` (e.g. `#nuoding/nuoding-0142`) opens that marker's popup, showing its type
  again if it was hidden. While a popup is open the address bar shows its link (without adding history
  entries), and "Copy link" in the popup footer copies it without `?lang=`, so whoever opens it gets their own
  language. A link typed into the address bar works too; an unknown marker id leaves just the map.
- Divine Trials count per stage (a "layer" on the site), like the game: 65 in Nuoding. Their popup lists the
  layers (stars, and for combat trials the minimum level and the recommended rating) instead of the "found"
  button: clicking a layer that is not done marks it and the earlier ones, clicking a done layer unmarks it
  and the later ones, and a button marks all of them done. A started trial shows a `4/10` badge next to its marker; a complete one
  counts as found. Game terms vs the site's wording: SPEC §4.6.
- Progress is the set of found marker ids, saved per map in `localStorage` (`slmap:v1:progress:<map>`), plus
  the layers done per Divine Trial (`slmap:v1:trials:<map>`). Ids are permanent, so progress survives data
  updates, and ids that no longer exist are ignored in the counts. "Export"/"Import" in the sidebar save and
  restore a JSON backup (`{ app, version, exportedAt, progress, trials }`; `trials` is optional, so older
  backups still import); importing replaces the saved progress after a confirmation.
- Popups pan into view even at the edges of the map (the pan limits are lifted while a popup is open), open
  below the zoom buttons, and scroll inside on short screens.
- Entry lists (for example the chest sets) expand under their type. Clicking an entry frames and highlights
  its markers on the map, and shows the type again if it was hidden.
- UI texts live in `i18n/<lang>.json` (flat keys), entry names in `i18n/entries.<map>.<lang>.json` and
  marker names, notes and howtos in `i18n/markers.<map>.<lang>.json`.
  Missing keys fall back to English. To add a language, create `i18n/<lang>.json` with the keys of
  `i18n/en.json` and list it in `i18n/languages.json` (`{"pt": "Português"}`). Only listed languages are
  offered or auto-detected, so the UI is never half translated. Try it with `?lang=pt` (any case: `?lang=PT`).
  The top bar selector saves the choice. Game terms (category, region, entry names) are the official in-game
  texts; the site's own UI strings (filters, backup, popups) are unofficial translations, so corrections from
  native speakers are very welcome. Keys missing from a language (for example `type.book`) fall back to English.
- Entries appear in the order of the rows in `entries.csv`, so keep that order equal to the in-game list.
- Tunables: `MARKER_SHRINK_PER_ZOOM` / `MARKER_MIN_SCALE` in `js/layers.js` (marker size when zoomed out),
  `wheelPxPerZoomLevel` in `js/app.js` (wheel zoom speed), `tiles.maxZoom` in `data/maps.json`.
