# Data and assets guide

**This document:** how the map data and the assets are made, checked and changed: the CSV files, the build,
the game tables, collecting in-game, calibration, adding a region, and the tiles and icons. **Not here:** what
the data means to the site (SPEC §4) and facts about the game (`docs/GAME-NOTES.md`). The rules that protect
this data (permanent ids, generated files never edited by hand, the owner's CSVs) are in `CLAUDE.md`
"Invariants". **Which document holds what:** README "Documentation".

## How the data flows

Each region (a "map" in the code, with an id like `nuoding`) has its source data in `data/src/<map>/`: four
CSV files, one tab each of the collection spreadsheet, exported as UTF-8 CSV. A new region's CSVs start from
the game's own tables ("Game data") and are completed in-game ("Collecting in-game").
`tools/build_data.py` validates them and writes the JSON the site reads. The JSON is committed, and CI fails
when it does not match the CSVs.

```text
game tables --(game_data.py export)--> data/src/<map>/*.csv <-- collected in-game (spreadsheet)
                                               |
                                    tools/build_data.py (validates)
                                               v
      data/markers/<map>.json, data/entries/<map>.json, i18n/entries.<map>.*, i18n/markers.<map>.*
```

## Building and checking

The collection spreadsheet (one tab per map) is exported as UTF-8 CSV into
`data/src/<map>/markers.csv` and `data/src/<map>/entries.csv` (plus `marker_texts.csv` for
marker names, notes and howtos, and `stages.csv` for Divine Trials), then:

```text
python tools/build_data.py nuoding            # validate, then write the JSON files
python tools/build_data.py nuoding --check    # validate only
python tools/build_data.py nuoding --strict   # warnings also fail the build
```

It writes `data/markers/<map>.json`, `data/entries/<map>.json`,
`i18n/entries.<map>.<lang>.json` and `i18n/markers.<map>.<lang>.json` (marker texts). Nothing
is written when there are errors. Use a dot as the decimal separator in the CSV. Only the columns
marked "always" or "yes" below must exist; any other column can be left out of a sheet when no row
uses it, and column order does not matter.

## The CSV files

### `markers.csv`

| Column | Required | Meaning |
| --- | --- | --- |
| `id` | always | `<map>-0001`: unique, permanent, never reused |
| `type` | always | `chest_normal`, `chest_coop`, `chest_challenge`, `chest_contract`, `chest_boss`, `chest_respawn`, `crystal`, `divine_trial`, `encounter`, `teleport`, `viewpoint`, `seed`, `mechanism`, `portal`, `book`, `boss`, `arena` |
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
| --- | --- | --- |
| `id` | yes | lowercase slug, e.g. `nuoding-academy-1`; unique within a map, not across maps |
| `type` | yes | the marker type of its members (same vocabulary as `markers.csv`) |
| `name_en` | yes | name exactly as shown in the game |
| `size` | yes | expected number of markers (the `11/11` in the game) |
| `tags` | optional | separated by `;`, e.g. `purple_demon_eye` |
| `name_pt`, `name_zh`, `desc_en`, `desc_pt`, `desc_zh` | optional | official texts |

Entries appear on the site in the order of the rows in `entries.csv`, not alphabetically, so keep that order
equal to the in-game list.

### `marker_texts.csv`

Texts that belong to one marker, one row per marker and field (rows may be in any order):

| Column | Required | Meaning |
| --- | --- | --- |
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
  times". Any marker type; the popup shows it behind a "Show solution" button.

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
| --- | --- | --- |
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
to compare with the game's Divine Trial counter (`docs/GAME-NOTES.md` "Exploration counts").

## Checks

What the build checks and why is designed in SPEC §8; this is the list as implemented.

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

The warnings expected today are listed in ROADMAP "Known gaps".

## Game data

The game client keeps its data in config tables (`.xc`, a format of its own, read by `tools/game_tables.py`;
the format is described at the top of that file). They hold every object the exploration counters count,
with its position, so a region's CSVs can start from the game instead of from a walk around the map:

```text
python tools/game_data.py export suotuo --game "C:/Soul Land：New World/app/dldlslkxy"
python tools/game_data.py compare nuoding --game "C:/Soul Land：New World/app/dldlslkxy"
```

`--game` is the folder that holds `BuildRes/` and `Res/`. The game files are read in place: nothing from
them is copied into the repo (SPEC §10), only the CSVs written from them. The region is the game scene whose
English name equals `map.<map>` in `i18n/en.json`.

- `export` fills an empty map (it refuses a `markers.csv` with rows) and lists what it left out and what is
  still to fill in by hand. It also prints the map's exploration milestones and its calibration for
  `maps.json`. After that the CSVs are the owner's, edited as usual.
- `compare` checks a map's CSVs against the game: positions, entries and their order, `entry_index`,
  names and descriptions in the three languages, the tags it can tell, trial stars and CP, milestones and
  calibration. An entry with no position in the tables (most encounters) is matched by its English name.
  Run it after a game update.

Names are written in the site's wording (SPEC §5): no closing period, and `": "` between the parts of a
Divine Trial's English and Portuguese name where the game sometimes writes `" · "`. `compare` applies the
same rule, so it does not report those.

From the game: markers of every type below, with game coordinates (`round(X + 512)`, `round(Z + 512)` of the
NPC's spawn point; the in-game readout matches them exactly or within 1), entries in the in-game order with
their official names and descriptions, `entry_index` (the order of the `[Location N]` links), the
decryption chest kinds (a guarded one, `box_npc.BoxType` 8, is a `chest_boss`) and contract elements, the
tags `guarded`, `hidden`, `grappling_hook` and `purple_demon_eye` (from `box_npc` and the entry
descriptions), Divine Trial names, subtypes, stars and recommended CP, teleport, viewpoint and book names,
Nuoding's respawned chests (`activity_explore_value`, `magic_pupil_npc`: one site entry per game group, SPEC §4.5),
encounter names and descriptions (`HandBookTips`) and the positions of those triggered by NPCs (with all
their points), the exploration value cap, the reward milestones and the calibration (`map_position`).
Checked on 2026-11-16: Nuoding's hand-collected CSVs matched the tables on all 338 points (280 exactly, 58
within 1 unit).

Objects the game counts but lists in no entry get an entry of the site's own, `unlisted-<n>`, tagged
`unlisted` (SPEC §4.3); `export` names them "Outside the game's list" and asks for the area in each name.

Not in the tables, so still collected in-game: coop chest `players`, combat stage `level` (the game gates
layers on story quests, not a level), poison or fire seal on Xuanyu Hand chests, the location-specific tags,
challenge chest pillars, notes and howtos, `links`, portals, seeds, and encounters triggered by an item, a
task or a mount (Ownerless Objects is one).

## Collecting in-game

For what the tables lack, and to check what they give. Per entry: complete the entry in-game, use Answer to
paste the `[Location N]` text into chat, click each location (the character walks exactly onto the point),
and record entry, `entry_index`, `x`, `y` exactly as shown, without rounding. Crystals, special chests and
sets follow the same flow. Trials, pillars, mechanisms and encounter points are noted separately. In regions
not completed yet the Answer only exists once the entry is complete.

## Calibration

`data/maps.json` holds `scaleX`/`scaleY` (game Y grows upwards, image pixel Y grows downwards, hence the
negative `scaleY`) and `offsetX`/`offsetY`. They come from the game: its `map_position` table places each
region's map image, and `python tools/game_data.py export <map>` prints the calibration that follows for the
image width in `maps.json` (`compare` reports a `maps.json` that differs from it). For an image `W` pixels
wide, with `MapDetailPictureSize` `S`, `MapDetailPictureMultiple` `M` and `MapDetailPicturePosition` `(dx, dy)`:

```text
scale   = W / (S × M)                              px per game unit
centre  = (512 + dx / 2.3, 512 + dy / 2.3)          the game point at the image centre
offsetX = W/2 − scale × centreX     offsetY = W/2 + scale × centreY     scaleY = −scale
```

2.3 is `WorldMapMultiple`, the same for every region with a map; dividing the image offset by it is
inferred, not read from the game code, and was checked against the points the owner measured in-game:

| Map | Image | Scale (px per game unit) | Offsets | Against the measured points |
| --- | --- | --- | --- | --- |
| Nuoding | 4096² | ±3.574799 | 424.419577, 3659.14634 | RMS 2.5 px (0.7 game units) over 11 points, a constant 0.65 units in X |
| Suotuo | 2048² | ±1.645002 | 297.624327, 1751.80611 | RMS 3.1 px (1.9 game units) over 10 points |

The game readout is rounded to whole units and Suotuo's own map draws the character a few pixels off, so
these errors are within what the points can tell. A least-squares fit of the points (below) is the fallback
for a region whose `map_position` row is missing or does not match its image. Markers store game coordinates,
so changing the calibration never touches a marker.

- The readout in the bottom-left corner shows game coordinates; a click pins the reading (also logged to the
  console). With offsets set to `null` it shows image pixels only.
- To check a calibration (or fit one by hand), fill `data/calibration/<map>.json` with
  `{"x": ..., "y": ..., "px": ..., "py": ...}` (game coordinates and the observed pixel), then run
  `python tools/check_calibration.py data/maps.json <map> data/calibration/<map>.json`. It prints the
  least-squares fit and each point's error in pixels. A few points spread over the map are enough to
  check the game's calibration.
- Then check that a few known markers land exactly on their in-game positions.

## Adding a region

The steps, in order (each one is described above or under "Assets"):

1. **Pick the map id.** Map ids use hyphens, as they go in the address (`#tian-dou`), and are permanent.
   Suotuo's portals already use `tian-dou` and `xing-dou-forest` (Xing Dou Great Forest). Proposed for the
   others, to confirm with the owner when each one is added: `xing-dou-mixed` (Mixed Area of Xing Dou
   Forest), `sunset-forest`, `city-of-slaughter`, `dragon-island`.
2. **Name it** in `i18n/en.json`, `pt.json` and `zh.json` (`map.<id>`, the official name). `game_data.py`
   finds the region by the English one.
3. **Make the tiles** from the map image ("Assets"). The image stays in `maps/` (ignored by git) and may keep
   underscores in its file name; the tiles folder, `tiles/<id>`, follows the id.
4. **Add the `maps.json` entry** with `"draft": true`: the image size and the tiles (`tileSize` 256,
   `maxNativeZoom` 4 for a 4096² image and 3 for a 2048² one, `maxZoom` one step above it).
5. **Export the CSVs** (`game_data.py export <id>`, "Game data"), and copy the milestones and the calibration
   it prints into `maps.json`.
6. **Complete the data in-game** (the list under "Game data" says what the tables lack) and check the
   calibration with a few measured points ("Calibration").
7. **Build** (`build_data.py <id>`) and read the warnings. CI checks every map in `maps.json` by itself.
8. **Publish:** remove `"draft"` when the owner decides the map has its data. Until then its link (`#<id>`)
   opens it, but the region selector lists it only while it is the current map (`js/maps.js`), so players do
   not land on an empty map.
9. **Record it:** the game's counts in `docs/GAME-NOTES.md`, the state in `docs/ROADMAP.md`.

## Assets

Map images are not committed (`maps/` is ignored; only the generated tiles are published). To regenerate
the tiles after the map image changes (341 files, ~5.6 MB for a 4096x4096 image):

1. `pip install pillow`
2. `python tools/make_tiles.py maps/nuoding.png tiles/nuoding` (Suotuo: 2048x2048, 85 files, ~1.1 MB)

Regenerate tiles only when the image changes: another Pillow version may encode different bytes and bloat
the history.

Marker icons (`icons/*.png`) are sprites from the game's UI atlases. To regenerate them, export each atlas
with AssetRipper ("Export project") into `maps/icons/raw/<atlas>/` (ignored, like the map images: currently
`worldmappanel`, `worlduipanel` and `commonui`) and run `python tools/make_icons.py` (Pillow). Which sprite
becomes which icon is the `ICONS` table at the top of the script (and `TINTS`, icons made by tinting
another: the purple respawned chest); it reads each sprite's rectangle from its
`.asset` file, trims it to the drawing and centers it on a square. Like the tiles, rerun it only when a sprite
changes. Which sprite a type uses, and why, is designed in SPEC §9.

The site icon is `favicon.svg`; after changing it, update the same geometry in `tools/make_favicon.py` and
run `python tools/make_favicon.py` (Pillow) to rebuild `favicon.ico` and `apple-touch-icon.png`.
