# Data and assets guide

**This document:** how the map data and the assets are made, checked and changed: the CSV files, the build,
the game tables, collecting in-game, calibration, adding a region, and the tiles and icons. **Not here:** what
the data means to the site (SPEC §4) and facts about the game (`docs/GAME-NOTES.md`). The rules that protect
this data (permanent ids, generated files never edited by hand, the owner's CSVs) are in `CLAUDE.md`
"Invariants". **Which document holds what:** README "Documentation".

## How the data flows

Each region (a "map" in the code, with an id like `nuoding`) has its source data in `data/src/<map>/`, as
CSV files. A new region's CSVs start from the game's own tables ("Game data") and are completed in-game
("Collecting in-game"). `tools/build_data.py` validates them and writes the JSON the site reads. The JSON is
committed, and CI fails when it does not match the CSVs.

```text
game tables --(game_data.py export)--> data/src/<map>/*.csv <-- collected in-game (spreadsheet)
                                               |
                                    tools/build_data.py (validates)
                                               v
      data/markers/<map>.json, data/entries/<map>.json, i18n/entries.<map>.*, i18n/markers.<map>.*
```

The CSV files are the tabs of the collection spreadsheet, one set per map, exported as UTF-8 CSV:

| File | One row per | Holds |
| --- | --- | --- |
| `markers.csv` | marker (or encounter point) | position, type, entry and the type's own fields |
| `entries.csv` | entry of the game's exploration list | size, tags, official names and descriptions |
| `marker_texts.csv` | marker and text field | marker names, notes and howtos, in the three languages |
| `stages.csv` | Divine Trial stage | stars, level and recommended CP |

## Building and checking

```text
python tools/build_data.py nuoding            # validate, then write the JSON files
python tools/build_data.py nuoding --check    # validate only
python tools/build_data.py nuoding --strict   # warnings also fail the build
```

The build writes `data/markers/<map>.json`, `data/entries/<map>.json`, `i18n/entries.<map>.<lang>.json` and
`i18n/markers.<map>.<lang>.json` (the marker texts). It writes nothing when there are errors.

In every CSV file:

- use a dot as the decimal separator;
- only the columns marked "always" or "yes" below must exist; any other column can be left out of a sheet
  when no row uses it;
- column order does not matter.

## The CSV files

### `markers.csv`

| Column | Required | Meaning |
| --- | --- | --- |
| `id` | always | `<map>-0001`: unique, permanent, never reused |
| `type` | always | `chest_normal`, `chest_coop`, `chest_challenge`, `chest_contract`, `chest_boss`, `chest_respawn`, `crystal`, `divine_trial`, `encounter`, `teleport`, `viewpoint`, `seed`, `mechanism`, `portal`, `book` |
| `x`, `y` | always | game coordinates, as shown in the game UI |
| `entry` | for chests, crystals, encounters, teleports, viewpoints and seeds | entry id, or its English name when no other entry has it |
| `entry_index` | optional | number of the `[Location N]` link in the in-game answer |
| `subtype` | `divine_trial` | `puzzle` or `combat` |
| `players` | `chest_coop`; optional for `chest_challenge` | 1 to 4; on a challenge, empty means a single player |
| `contract` | `chest_contract` | `wood`, `flame` or `frost` |
| `pillar_x`, `pillar_y` | optional, `chest_challenge` | both or neither |
| `seed` | `seed` | number shown by the game when picking the seed up |
| `requires_seed` | `mechanism` | seed number needed to activate it |
| `to` | `portal` | destination map id |
| `links` | optional | related marker ids, separated by `;` |
| `tags` | optional | this marker's own requirements, separated by `;`, on top of its entry's tags (e.g. `grappling_hook` on one chest of a `purple_demon_eye` entry) |

An encounter with several points repeats its id on several rows; the first row is the primary point. Each
point gets its own icon on the map, and the encounter still counts once. No other type may repeat an id.

### `entries.csv`

| Column | Required | Meaning |
| --- | --- | --- |
| `id` | yes | lowercase slug, e.g. `nuoding-academy-1`; unique within a map, not across maps |
| `type` | yes | the marker type of its members (same vocabulary as `markers.csv`) |
| `name_en` | yes | name exactly as shown in the game; two entries may share one, as in Sunset Forest's list |
| `size` | yes | expected number of markers (the `11/11` in the game) |
| `tags` | optional | separated by `;`, e.g. `purple_demon_eye` |
| `name_pt`, `name_zh`, `desc_en`, `desc_pt`, `desc_zh` | optional | official texts |

Entries appear on the site in the order of the rows, not alphabetically, so keep that order equal to the
in-game list.

### `marker_texts.csv`

Texts that belong to one marker, one row per marker and field, in any order:

| Column | Required | Meaning |
| --- | --- | --- |
| `marker` | yes | marker id |
| `field` | yes | `name`, `note` or `howto` (below) |
| `en` | yes | English text, the fallback for every language |
| `pt`, `zh` | optional | translations |

| Field | For | Meaning | Example |
| --- | --- | --- | --- |
| `name` | `divine_trial`, `book`, `teleport`, `viewpoint` only | the marker's own name: the popup title, ahead of the entry name. Use the game's official name, except for obvious mistakes such as a stray final period. | Trial of Strength: Shield of Stone |
| `note` | any type | a short fact the player needs to find the point, always shown in the popup | Inside the cave under the plains |
| `howto` | any type | the solution, for what the game's description does not say; the popup shows it behind "Show solution" | Talk to Andy five times |

```csv
marker,field,en,pt,zh
nuoding-0281,name,Trial of Strength: Shield of Stone,Provação da Força: Escudo de Pedra,力之试炼·岩之盾
nuoding-0185,note,Grapple onto the roof using the grappling hook.,Suba no telhado usando o gancho.,使用飞天神爪登上屋顶。
```

### Divine Trials: `stages.csv`

Divine Trials have no entry in the game's list. A trial lives in three files:

- the pillar is a `divine_trial` row in `markers.csv` (`id`, `x`, `y`, `subtype`);
- its name is a `name` row in `marker_texts.csv`;
- its stages are rows in `stages.csv`, one per stage, in any order:

| Column | Required | Meaning |
| --- | --- | --- |
| `trial` | yes | id of a `divine_trial` marker |
| `stage` | yes | 1, 2, 3... in the order the stages are played, with no gaps (3 to 10 stages) |
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

The third row is a combat stage whose recommended CP is not known yet; the last one is a puzzle stage. The
build adds a `stages` list, in stage order, to the marker, and prints the stage total of the map, to compare
with the game's Divine Trial counter (`docs/GAME-NOTES.md` "Exploration counts").

## Checks

What the build is meant to check, and why, is designed in SPEC §8. This is the list as implemented.

Errors (nothing is written):

- duplicate or malformed ids, unknown types, missing columns for a type, unknown entries, a marker that names
  an entry by a name two entries share, coordinates outside the image, unknown link targets, ids whose type
  changed since the last build;
- more markers than an entry's `size`, an `entry_index` above `size` or repeated;
- Divine Trials with stage gaps, repeated stages, fewer than 3 or more than 10 stages, stars outside 1 to 5,
  `level` missing on a combat trial, or `level` or `cp` filled in on a puzzle one;
- marker texts with an unknown marker or field, a `name` on a type other than `divine_trial`, `book`,
  `teleport` or `viewpoint`, a repeated field, or no `en`;
- malformed or repeated tags, or `hidden` with `purple_demon_eye` on the same chest (SPEC §4.4).

Warnings (the build still writes; `--strict` makes them errors):

- entries that are still incomplete, `entry_index` gaps, ids that disappeared since the last build;
- mechanisms and seeds that do not match, portals to maps not in `maps.json` yet;
- Divine Trials, books, teleports and viewpoints without a name; Divine Trials without stages; combat stages
  without a recommended CP yet; stage levels that go down;
- marker tags already on the entry.

The warnings expected today are listed in ROADMAP "Known gaps".

## Game data

The game client keeps its data in config tables: `.xc` files, in a format of its own, read by
`tools/game_tables.py` (the format is described at the top of that file). They hold every object the
exploration counters count, with its position, so a region's CSVs can start from the game instead of from a
walk around the map:

```text
python tools/game_data.py export suotuo --game "C:/Soul Land：New World/app/dldlslkxy"
python tools/game_data.py compare nuoding --game "C:/Soul Land：New World/app/dldlslkxy"
```

- `--game` is the folder that holds `BuildRes/` and `Res/`. The game files are read in place: nothing from
  them is copied into the repo (SPEC §10), only the CSVs written from them.
- The region is the game scene whose English name equals `map.<map>` in `i18n/en.json`.
- `export` fills an empty map: it refuses a `markers.csv` that has rows. It lists what it left out and what
  is still to fill in by hand, and prints the map's exploration milestones and calibration for `maps.json`.
  After that the CSVs are the owner's, edited as usual.
- `compare` checks a map's CSVs against the game: positions, entries and their order, `entry_index`, names
  and descriptions in the three languages, the tags it can tell, trial stars, levels and CP, milestones and
  calibration. An entry with no position in the tables (most encounters) is matched by its English name. Run
  it after a game update.

Names are written in the site's wording (SPEC §5): no closing period, and `": "` between the parts of a
Divine Trial's English and Portuguese name where the game sometimes writes `" · "`. `compare` applies the same
rule, so it does not report those differences.

What comes from the tables:

| Data | Where in the game |
| --- | --- |
| the counted objects, as markers of every type in this table | `scene_explore` |
| their game coordinates | `scene_static_npc`, the NPC's spawn point: `round(X + 512)`, `round(Z + 512)`; the in-game readout matches them exactly or within 1 |
| entries, in the in-game order, with their official names and descriptions | `scene_explore_note`; an entry with no name there takes its one object's name, as the game's list does |
| `entry_index` | the order of the `[Location N]` links |
| the decryption chest kinds and the contract elements | the entry's English name ("Cooperative Chest" anywhere in it, "Pillar of Empty Path", the Coffers' elements), else `box_npc` (`BoxType` 8, a chest guarded by a boss, is a `chest_boss`). `BoxType` alone does not tell co-op from challenge chests: Nuoding's mix 5, 9 and 12 |
| the tags `guarded`, `hidden`, `grappling_hook` and `purple_demon_eye` | `box_npc` (`BoxType` 8 is `guarded`), the NPC's `Script` (`ShowNpc` is `hidden`) and the entry's Chinese description: 遮蔽 is `hidden`, 钩爪 `grappling_hook`, 紫极魔瞳 `purple_demon_eye`. The invisible (隐形) Tang Sect chests are `purple_demon_eye` only, although the game's English calls them "hidden" too |
| Divine Trial names, subtypes, stars and recommended CP | `discover_controller*` |
| the `level` of combat stages | each layer's `Condition` in `discover_controller_level`, a `player_condition` row (`Type` 1, `Param` `1,<level>`); it matched all 80 levels collected in-game in Nuoding and Suotuo (2026-11-22) |
| teleport, viewpoint and book names | `box_npc`, `nofight_npc` |
| Nuoding's respawned chests, one site entry per game group (SPEC §4.5) | `activity_explore_value`, `magic_pupil_npc` |
| encounter names and descriptions, and the points of those triggered by an NPC | `fortuitousmeet`, `HandBookTips` |
| the exploration value cap | `scene_explore_control` |
| the reward milestones | `scene_explore_reward`, by the region's `RewardId` (not `Push`, which differs in some regions) |
| the calibration | `map_position` |

Each table's role is in the docstring at the top of `tools/game_data.py`. Checked on 2026-11-16:
Nuoding's hand-collected CSVs matched the tables on all 338 points (280 exactly, 58 within 1 unit).

Objects the game counts but lists in no entry get an entry of the site's own, `unlisted-<n>`, tagged
`unlisted` (SPEC §4.3). `export` names them "Outside the game's list" and asks for the area in each name.

Not in the tables, so still collected in-game:

- the `players` of co-op chests;
- the poison or fire seal on Xuanyu Hand chests, and the location-specific tags;
- which chests of an entry that names both the Grappling Hook and the Xuanyu Hand need which (Xing Dou Great
  Forest's Tang Sect Chest Three): `export` asks for each chest's tag and `compare` checks that it has one.
  Ask the owner to check in-game. The grappling-hook points (`scene_static_hoolclaw`) do not tell it: the
  hook takes the player up to an area, such as a roof that may be a hundred units wide, so the chest can be
  far from the point (in Nuoding and Suotuo some are over 30 units away), and other chests sit right next to
  one;
- the pillars of challenge chests;
- notes, howtos and `links`;
- portals and seeds;
- encounters triggered by an item, a task or a mount (Ownerless Objects is one).

## Collecting in-game

For what the tables lack, and to check what they give. Per entry:

1. Complete the entry in-game. In a region not completed yet, the Answer exists only once the entry is
   complete.
2. Use Answer to paste the `[Location N]` text into the chat.
3. Click each location: the character walks exactly onto the point.
4. Record the entry, `entry_index`, `x` and `y` exactly as shown, without rounding.

Crystals, special chests and sets follow the same flow. Trials, pillars, mechanisms and encounter points are
noted separately.

## Calibration

`data/maps.json` holds each map's `scaleX`, `scaleY`, `offsetX` and `offsetY`. Game Y grows upward and image
pixel Y grows downward, hence the negative `scaleY`. The values come from the game: its `map_position` table
places each region's map image, and `python tools/game_data.py export <map>` prints the calibration that
follows for the image width in `maps.json` (`compare` reports a `maps.json` that differs from it).

For an image `W` pixels wide, with `MapDetailPictureSize` `S`, `MapDetailPictureMultiple` `M` and
`MapDetailPicturePosition` `(dx, dy)`:

```text
scale   = W / (S × M)                              px per game unit
centre  = (512 + dx / 2.3, 512 + dy / 2.3)          the game point at the image centre
offsetX = W/2 − scale × centreX     offsetY = W/2 + scale × centreY     scaleY = −scale
```

2.3 is `WorldMapMultiple`, the same for every region with a map. Dividing the image offset by it is inferred,
not read from the game code. It was checked against the points the owner measured in-game:

| Map | Image | Scale (px per game unit) | Offsets | Against the measured points |
| --- | --- | --- | --- | --- |
| Nuoding | 4096² | ±3.574799 | 424.419577, 3659.14634 | RMS 2.5 px (0.7 game units) over 11 points, a constant 0.65 units in X |
| Suotuo | 2048² | ±1.645002 | 297.624327, 1751.80611 | RMS 3.1 px (1.9 game units) over 10 points |
| Xing Dou Great Forest | 2048² | ±1.874597 | 64.206321, 1943.041569 | RMS 1.8 px (1.0 game units) over 9 points, a constant 0.85 units in X |
| Tian Dou City Area | 2048² | ±1.28 | 472.709565, 1863.012174 | RMS 1.0 px (0.8 game units) over 10 points, worst 1.5 px |
| Sunset Forest | 2048² | ±2 | 0, 2048 | RMS 1.2 px (0.6 game units) over 10 points, worst 2.2 px |

The game's readout is rounded to whole units, and Suotuo's own map draws the character a few pixels off, so
these errors are within what the points can tell. Markers store game coordinates, so changing the calibration
never touches a marker.

The calibration reproduces the game's own map, not the 3D world. The map image is only an approximate drawing
of the world: a feature can be drawn a few units away from where it is in 3D (`docs/GAME-NOTES.md` "Regions"),
and no single calibration can match every feature. So measure points against the game's map (where it draws
the player's icon, or where the character goes after a click on the map), never by standing on a 3D feature
and finding it in the image. Where the drawing misleads the player about a marker (a chest drawn on the wrong
side of a fence), give the marker a `note`; do not move it or the calibration.

To check a calibration, or to fit one by hand when a region's `map_position` row is missing or does not match
its image:

1. Read points on the map: the readout in the bottom-left corner shows game coordinates, and a click pins the
   reading (also logged to the console). With the offsets set to `null` it shows image pixels only. Take each
   point where the game's map puts the player (see above).
2. Fill `data/calibration/<map>.json` with `{"x": ..., "y": ..., "px": ..., "py": ...}` per point: the game
   coordinates and the observed pixel. A few points spread over the map are enough.
3. Run `python tools/check_calibration.py data/maps.json <map> data/calibration/<map>.json`. It prints the
   least-squares fit and each point's error in pixels.
4. Check that a few known markers land exactly on their in-game positions.

## Adding a region

The steps, in order (each one is described above or under "Assets"):

1. **Pick the map id.** Map ids use hyphens, as they go in the address (`#tian-dou`), and are permanent.
   Portals already use `tian-dou` (Tian Dou City Area), `xing-dou-mixed-area` (Mixed Area of Xing Dou
   Forest), `sunset-forest` and `dragon-island` (a map the site leaves out, SPEC §4.9). Proposed for the last
   region, to confirm with the owner when it
   is added: `city-of-slaughter`.
2. **Name it** in `i18n/en.json`, `pt.json` and `zh.json` (`map.<id>`, the official name). `game_data.py`
   finds the region by the English one.
3. **Make the tiles** from the map image ("Assets"). The image stays in `maps/` (ignored by git) and may keep
   underscores in its file name; the tiles folder, `tiles/<id>`, follows the id.
4. **Add the `maps.json` entry** with `"draft": true`: the image size and the tiles (`tileSize` 256,
   `maxNativeZoom` 4 for a 4096² image and 3 for a 2048² one, `maxZoom` one step above it). When the points
   fill only part of the image, add a `view` around them, so the map opens there (SPEC §4.1).
5. **Export the CSVs** (`game_data.py export <id>`, "Game data"), and copy the milestones and the calibration
   it prints into `maps.json`. Read every line it prints: a `WARNING` means a value no player could see.
6. **Check the export against the game** before building on it: the region's counters (one per category),
   its exploration value cap and its reward milestones, from `docs/GAME-NOTES.md` when it has them, else from
   a screenshot of the game's exploration panel. The tables do not always say what the game shows: the
   milestones were once read from a column that gave 150 to 1500 for a cap of 565 (Xing Dou Great Forest).
7. **Complete the data in-game** ("Game data" lists what the tables lack), and check the calibration with a
   few measured points ("Calibration").
8. **Build** (`build_data.py <id>`) and read the warnings. CI checks every map in `maps.json` on its own.
9. **Publish:** remove `"draft"` when the owner decides the map has its data. Until then its link (`#<id>`)
   opens it, but the region selector lists it only while it is the current map (`js/maps.js`), so players do
   not land on an empty map.
10. **Record it:** the game's counts in `docs/GAME-NOTES.md`, the state in `docs/ROADMAP.md`.

## Assets

Regenerate an asset only when its source changes: another Pillow version may encode different bytes and
bloat the history. All three scripts need Pillow (`pip install pillow`).

### Tiles

The map images are not committed (`maps/` is ignored); only the generated tiles are published.

```text
python tools/make_tiles.py maps/nuoding.png tiles/nuoding
```

A 4096×4096 image gives 341 files (~5.6 MB); a 2048×2048 one, like Suotuo's, 85 files (~1.1 MB).

### Marker icons

The icons in `icons/*.png` are sprites from the game's UI atlases.

1. Export each atlas with AssetRipper ("Export project") into `maps/icons/raw/<atlas>/` (ignored, like the
   map images). The atlases used today: `worldmappanel`, `worlduipanel` and `commonui`.
2. Run `python tools/make_icons.py`. It reads each sprite's rectangle from its `.asset` file, trims it to the
   drawing and centers it on a square.

Which sprite becomes which icon is the `ICONS` table at the top of the script; `TINTS` lists the icons made by
tinting another (the purple respawned chest). Which sprite a type uses, and why, is designed in SPEC §9.

### Site icon

The site icon is `favicon.svg`. After changing it, update the same geometry in `tools/make_favicon.py`, then
run `python tools/make_favicon.py` to rebuild `favicon.ico` and `apple-touch-icon.png`.
