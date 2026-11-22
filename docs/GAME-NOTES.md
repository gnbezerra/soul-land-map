# Notes on the game

**This document:** facts about *Soul Land: New World* that the site depends on, observed in-game or read
from the game's tables: regions, exploration counts and rules, loot, bosses, quirks of the game's texts.
Each fact says where it comes from, and observations carry their date. **Not here:** how the site models
these facts (`docs/SPEC.md`), how they get into the data (`docs/DATA.md`), and what is still to collect
(`docs/ROADMAP.md` "Waiting on the owner"). **Which document holds what:** README "Documentation".

## Regions

The site plans eight regions:

1. Nuoding City Area
2. Suotuo City Area
3. Xing Dou Great Forest
4. Tian Dou City Area
5. Sunset Forest
6. Mixed Area of Xing Dou Forest
7. City of Slaughter
8. Dragon Island

- The first seven follow the same category pattern; Dragon Island has no exploration (SPEC §4.9).
- Each region is fully separate, linked to the others by portals with loading screens.
- Their map images in the game's assets: three are 4096², Nuoding's among them; five are 2048², Suotuo's
  among them.
- The game tables have every region's data and calibration.

## Exploration counts

The counters of the game's exploration UI, per region and category (SPEC §4.2):

| Region | Normal Chest | Decryption Chest | Divine Trial | Divine Mind Crystal | Encounter | Other |
| --- | --- | --- | --- | --- | --- | --- |
| Nuoding City Area | 264 | 16 | 65 layers (10 pillars) | 28 | 5 | 10 (6 teleports, 4 viewpoints) |
| Suotuo City Area | 247 | 12 (2 of them Wolf Thief chests) | 51 layers (10 pillars) | 30 | 9 | 12 (8 teleports, 4 viewpoints) |
| Xing Dou Great Forest | 49 | 7 (all Coffers) | 20 layers (2 pillars) | 5 | 0 | 1 (1 teleport, no viewpoints) |
| Mixed Area of Xing Dou Forest | 172 | 9 | 12 | 20 | 2 | 14 (8 seeds, 6 teleports, no viewpoints) |

- **Nuoding's entries:** 20 normal-chest sets (sum 264); 16 decryption chests (4 cooperative, 6 Pillar of Empty
  Path, 6 Coffers), each an entry of size 1; 6 crystal sets (sum 28); 5 encounters; 2 "Other" entries (Light
  Up! Teleport 6, Enjoy the Scenery 4). Outside the counters: 150 respawned chests (SPEC §4.5).
- **Suotuo** (from the game tables): exploration value cap 3245. Its normal-chest entries add up to 217. The
  other 30 chests (14 in the south-west, 16 in the south-east) belong to NoteIds 1109 and 1110, which have no
  entry and no name in the game tables. Checked on a 247/247 character: every entry complete, 217/217. The
  site puts them in entries of its own (SPEC §4.3).
- **Xing Dou Great Forest** (from the game tables; the counters checked in-game by the owner on 2026-11-22):
  exploration value cap 565, every point in the north-west corner, the only part of the map image not under
  fog (the region is the forest's outskirts). 7 normal-chest sets (sum 49), 7 Coffers, 1 crystal set, 1
  teleport entry, no encounters.

## Exploration value

From the game's rules popup: EN "Area Exploration", PT "Exploração da Área", ZH 区域探索. The points are EN
"exploration points" or "exploration value", PT "valor de exploração", ZH 探索值. The last three columns are
the popup's own wording for each item; its "essences" are the Divine Mind Crystals and its "scenic spots" the
viewpoints.

| Item | Points | EN | PT | ZH |
| --- | --- | --- | --- | --- |
| Chest (any) | +5 each | Opening treasure chests | Abrir baús de tesouro | 开启宝箱 |
| Teleport point | +35 each | Activating Teleport Points | Ativar Pontos de Teletransporte | 激活传送点 |
| Viewpoint | +35 each | Activating scenic spots | Ativar pontos panorâmicos | 激活观景点 |
| Divine Mind Crystal | +10 each | Collecting essences | Coletar essências | 收集精粹 |
| Divine Trial | +10 per layer | Completing divine trials (each layer counts as 1 trial in multi-layer challenges) | Concluir Provações Divinas (em desafios com várias camadas, cada camada conta como 1 provação) | 完成神意试炼（多层挑战时，每层算作1个试炼） |
| Encounter | +80 each | Completing encounters | Concluir encontros | 完成奇遇 |

- Seeds are not in the list. The Mixed Area's 240 points reconcile only if a seed is +5 (unconfirmed).
- Nuoding totals 3080 exactly; Xing Dou Great Forest 565 (56 chests, 20 layers, 5 crystals, 1 teleport).
- Reward milestones: 250, 500, 1000, 1500, 2000 and 2500 (Nuoding and Suotuo); 150, 300, 400, 500 and 550
  (Xing Dou Great Forest, seen in-game on 2026-11-22); 75, 150, 300, 600, 900 and 1200 (Mixed Area). In the
  tables they are `scene_explore_reward`; the `Push` column of `scene_explore_control` lists other values in
  those last two regions (150 to 1500 in both).

## Loot observed in-game

How the site will model loot: SPEC §4.8 (not implemented yet). What the owner saw:

- **Normal chests:** one table for all, plus a fixed number of blue gems by the chest's look: 2 for the common
  one, 5 for the intermediate, 10 for the most elaborate.
- **Decryption chests:** each its own table, even when two give the same.
- **Respawned chests** (SPEC §4.5): one table per game group. A sample of 5 chests per group, on 2026-11-21;
  the ranges are what came out, not the game's limits:

| Group | The same in all 5 | Varies |
| --- | --- | --- |
| `good_A` | 6 Blue Crystal, 20 Fine Gold Fragments, 20 Hidden Weapon Polishing Stone, 500000 Silver Soul Coin, 1 Summon Voucher | Orange Soul Essence Shard 5–10 |
| `good_B` | 6 Blue Crystal, 1 Recruitment Crystal | Fading Soul Essence 3–4, Gold Obsidian Shard 6–10, Life Essence 10–14, Soul Crystal Shards 3–5 |
| `normal_A` | 3 Blue Crystal, 100000 Silver Soul Coin | Earth Breath 2–4, Life Essence 2–3, White Stone Residue 10 or 14, one item (Electric Crystal or Bursting Fungus Umbrella seen) |
| `normal_B` | 3 Blue Crystal, 100000 Silver Soul Coin | Earth Breath 3–5, Footprint Dust 10–17, Shimmering Crystal 1–2, one Spirit Crystal (Stalwart, Shackles, Overlord, Swift Wind seen) |
| `good_C` | 100000 Silver Soul Coin | everything else, see below |

Each `good_C` chest was a `normal_A` or a `normal_B` chest without its 3 Blue Crystal, plus one big bonus:
60 Blue Crystal, 10 Recruitment Crystal, 60 Life Essence (next to the base's 3, checked by the owner), 30 Soul
Crystal Shards or 30 Fading Soul Essence. Both kinds were in the same area, so the base looks like a draw,
not the place. One of them had a Hallucinogenic Fungus Umbrella, so the `normal_A` pick has at least three
options.

**Open, to settle when loot is implemented** (by opening more chests in-game, or from the tables if the loot
turns out to be there after all):

- which normal chest (entry or marker) has which gem look, and `nuoding-0105`'s;
- whether "Blue Crystal" is the blue gem of the normal chests (3 in the respawned normal ones, 6 in
  `good_A` and `good_B`, which fits a fixed amount per kind);
- whether `normal_A` and `normal_B` differ by the letter or by the area (all 5 `normal_A` sampled were in the
  north, all 5 `normal_B` in the south-east);
- the full option lists of each pick (the `normal_A` item, the Spirit Crystal, the `good_C` base and bonus),
  the real ranges and the weights;
- the class equipment's level cut-offs (low priority).

## Dragon Island

- 9 fixed boss respawns; bosses of the same species drop the same soul ring.
- Ancient Tooth Peak is the world-boss arena.
- A teleport near Silent Beach (Safe Zone) sits next to a whirlpool portal to Tian Dou City Area.

| Spawn location | Boss | Species |
| --- | --- | --- |
| Broken Tooth Reefs | Sly Supreme Orangutan | Supreme Orangutan |
| North Coast Beach | Combatant Diamond Mammoth | Diamond Mammoth |
| Thunder's Edge | Sly Mighty Kong Bear | Supreme Bear |
| West Coast Beach | Combatant Supreme Bear | Supreme Bear |
| East Coast Beach | Combatant Supreme Orangutan | Supreme Orangutan |
| South Coast Beach | Sly Supreme Orangutan | Supreme Orangutan |
| Hope Island | Sly Wolf Thief Leader | Wolf Thief |
| Soul Rest Island (north) | Combatant Wolf Thief Leader | Wolf Thief |
| Soul Rest Island (south) | Sly Diamond Mammoth | Diamond Mammoth |

## The game's texts

- The official English is inconsistent (Norton/Nuoding, Fugold/Floating Gold, Sunset Forest/Radiant Light
  Forest). The official PT is translated from Chinese and does not match the English names. How the site
  handles that: SPEC §5.
- The game's UI is laid out for Chinese and cuts off some translated strings: a few in English (added for the
  global release, and apparently reviewed), many in Portuguese (seen: "Rec.", "Adicionar", the trial window's
  "Mecânica de"). Do not take a cut-off string as the full official text (owner, 2026-11-21).
- The trial window's terms, and the site's wording for them: SPEC §4.6.
- The game's English says "hidden" for two kinds of chest that the Chinese and the site keep apart: 遮蔽
  (inside a box, a bush or under a rock; the site's `hidden`) and 隐形 (invisible until the Purple Demon Eye
  shows it; the site's `purple_demon_eye`). SPEC §4.4 has the tags.
- An exploration entry with no name in the tables shows its object's own name in the list: every encounter,
  and Xing Dou Great Forest's teleport entry, "Teleport Point of Xing Dou Forest Outskirts" (owner,
  2026-11-22). Entries that have a name, size 1 included (the decryption chests), show it.
