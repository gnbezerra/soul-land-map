#!/usr/bin/env python3
"""Read a region's exploration data from the installed game and turn it into the site's CSVs.

Usage:
    python tools/game_data.py export suotuo --game "C:/Soul Land：New World/app/dldlslkxy"
    python tools/game_data.py compare nuoding --game "C:/Soul Land：New World/app/dldlslkxy"

export   writes data/src/<map>/{markers,entries,marker_texts,stages}.csv from the game, and prints what it
         could not fill in. It refuses to touch a map whose markers.csv already has rows: after the first
         export the CSVs are the owner's, and `compare` is how they are checked against a newer game.
compare  matches the map's CSVs against the game and prints every difference, plus what it cannot check.

The game files are read in place and never copied into the repo (docs/DATA.md "Game data"). The region is
found by its English name: the scene whose MapName<scene> text equals i18n/en.json "map.<map>".

Where things come from (tables in the game's config folder, read by game_tables.py):
    scene_explore          every object the exploration counters count: type, NPC, entry (NoteId)
    scene_explore_note     the entries (in-game list): name, description, order
    scene_static_npc       NPC positions per scene; game coordinates = round(X + 512), round(Z + 512)
    box_npc, nofight_npc   chest kind (guarded, Purple Demon Eye); names of teleports and viewpoints
    activity_explore_value the chests that appear once all the normal chests are open (Nuoding only), in
                           groups such as nd_Newactivitybox_good_B_07; no counter in the game lists them
    magic_pupil_npc        objects that need the Purple Demon Eye (Type 2)
    discover_controller*   Divine Trials: puzzle or combat, trigger NPC, name, stars and CP per layer
    fortuitousmeet         encounters: name and what triggers them (NPCs, an item, a task...)
    scene_explore_control  exploration value cap and reward milestones
    map_position           the map image's placement, from which the calibration follows
"""
import argparse
import csv
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from game_tables import GameFiles  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
LANGS = ("en", "pt", "zh")
HALF = 512            # game coordinate = world X/Z + 512 (the map is 1024 units wide)
WORLD_MAP_SCALE = 2.3  # map_position.WorldMapMultiple, the same for every region; divides the image offset

# scene_explore (Type, ShowType) -> marker type. ShowType 2 chests are decryption chests; their kind
# comes from the entry name (decryption_kind), or from box_npc for a chest behind a boss.
KINDS = {(1, 1): "chest_normal", (1, 2): "decryption", (2, 3): "divine_trial", (3, 6): "teleport",
         (4, 6): "viewpoint", (5, 4): "crystal", (7, 5): "encounter", (8, 6): "seed"}
TRIAL_SUBTYPES = {1: "combat", 2: "puzzle"}
CONTRACTS = {"Dragonwood": "wood", "Desolate Flame": "flame", "Mysterious Frost": "frost"}
# Encounter trigger types (fortuitousmeet.ConditionType) whose parameter is an NPC with a position.
NPC_TRIGGERS = {"1", "6", "12"}
TRIGGER_NAMES = {"4": "item", "8": "task", "20": "mount", "22": "other"}
# Entry tags told by the entry's Chinese description (the tool each entry asks for). box_npc.BoxRare does not
# tell them apart: in Suotuo every Tang Sect chest has BoxRare 2, the grappling-hook ones too.
DESC_TAGS = {"钩爪": "grappling_hook", "紫极魔瞳": "purple_demon_eye", "隐形": "hidden"}
# Xuanyu Hand chests carry a poison (Lv. 1) or fire (Lv. 2) seal; the tables do not say which.
SEAL_HINT = "玄玉手"
# Tags the game data can tell (guarded: box_npc.BoxType 8; hidden: also a ShowNpc chest). Others, like a
# grappling hook needed by one chest of an entry, are about where the chest is.
DERIVED_TAGS = {"guarded", "hidden", *DESC_TAGS.values()}
TEXT_TYPES = {"divine_trial", "teleport", "viewpoint", "book"}
# Respawned chests (chest_respawn): activity_explore_value ids end in _<rarity>_<letter>_<number>. The game
# gives the groups no name, so each group is an entry of the site's own (RESPAWN_TEXTS in export).
RESPAWN_ID = re.compile(r"_(normal|good)_([A-Z])_(\d+)$")
RESPAWN_RARITIES = ("normal", "good")
NUMBER_WORDS = {"one": "1", "two": "2", "three": "3", "four": "4", "five": "5", "six": "6",
                "i": "1", "ii": "2", "iii": "3", "iv": "4", "v": "5", "vi": "6"}
MARKER_HEADER = ["id", "type", "entry", "entry_index", "x", "y", "subtype", "players", "contract",
                 "pillar_x", "pillar_y", "seed", "requires_seed", "species", "to", "links", "tags"]
ENTRY_HEADER = ["id", "type", "name_en", "size", "tags", "name_pt", "name_zh", "desc_en", "desc_pt", "desc_zh"]
TYPE_ORDER = ["chest_normal", "chest_coop", "chest_challenge", "chest_contract", "chest_boss", "divine_trial",
              "crystal",
              "encounter", "teleport", "viewpoint", "book", "chest_respawn"]


def game_xy(pos):
    # Python's round() rounds half to even, like Unity's Mathf.RoundToInt.
    return round(pos[0] + HALF), round(pos[2] + HALF)


def clean(text):
    """Game text without rich-text tags and with single spaces."""
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", text or "")).strip()


def site_name(name, trial=False):
    """The site's wording of a game name (SPEC §5): no closing period ('Choice.' -> 'Choice'), and a
    Divine Trial's en/pt name splits its parts with ': ' ('Provação da Sabedoria · Totem' -> '...: Totem').
    Chinese keeps the game's '·'."""
    out = {}
    for lang, text in name.items():
        if lang != "zh":
            text = re.sub(r"(?<!\.)\.$", "", text)
            if trial:
                text = text.replace(" · ", ": ")
        out[lang] = text
    return out


def slug(name, kind):
    """Entry id in the style of the existing CSVs: 'Tang Sect Chest One' -> 'tang-sect-1'."""
    words = re.sub(r"[^a-z0-9 ]+", " ", name.lower().replace("'", "")).split()
    if kind.startswith("chest") and len(words) > 1:
        words = [w for w in words if w not in ("chest", "of")]  # Pillar of Empty Path I -> pillar-empty-path-1
    words = ["coop" if w == "cooperative" else NUMBER_WORDS.get(w, w) if i and i == len(words) - 1 else w
             for i, w in enumerate(words)]
    return "-".join(words)


def decryption_kind(name_en):
    if name_en.startswith("Cooperative Chest"):
        return "chest_coop", {}
    if name_en.startswith("Pillar of Empty Path"):
        return "chest_challenge", {}
    for prefix, contract in CONTRACTS.items():
        if name_en.startswith(prefix) and "Coffer" in name_en:
            return "chest_contract", {"contract": contract}
    return None, {}


class Region:
    """One region's exploration data as the game defines it."""

    def __init__(self, game, scene):
        self.game, self.scene = game, scene
        self.text = {lang: game.texts(lang) for lang in LANGS}
        npcs = [r for r in game.rows("scene_static_npc") if r["SceneID"] == scene]
        self.npc = {}
        for r in npcs:
            self.npc.setdefault(r["NpcID"], r)
        self.items = []     # markers the site can show (see _item)
        self.skipped = []   # (reason, description) of what export leaves out
        self.entries = {}   # note id -> {"kind", "name", "desc", "order", "count"}
        self._read_explore()
        self._read_respawn()
        self._read_books()
        control = next((r for r in game.rows("scene_explore_control") if r["Id"] == scene), {})
        self.value_cap = control.get("ExploreValueMax")
        self.milestones = [int(v) for v in str(control.get("Push", "")).split(";") if v.strip()]
        self.calibration = self._calibration()

    def t(self, key):
        return {lang: clean(self.text[lang].get(key, "")) for lang in LANGS}

    def _item(self, kind, source, xy=None, **extra):
        item = {"type": kind, "source": source, "points": [xy] if xy else [], "tags": set(), "extra": {}}
        item.update(extra)
        self.items.append(item)
        return item

    def _read_explore(self):
        notes = {r["Id"]: r for r in self.game.rows("scene_explore_note")}
        rows = [r for r in self.game.rows("scene_explore") if r["SceneId"] == self.scene]
        boxes = {r["Id"]: r for r in self.game.rows("box_npc")}
        meets = {r["FortuitousmeetId"]: r for r in self.game.rows("fortuitousmeet")}
        trials = defaultdict(int)
        index = Counter()
        for r in rows:
            kind = KINDS.get((r["Type"], r["ShowType"]))
            npc_id = r["NpcId"]
            if kind == "divine_trial":
                trials[int(npc_id.rsplit("_", 1)[0])] += 1
                continue
            note_id = r["NoteId"]
            note = notes.get(note_id)
            if kind is None:
                self.skipped.append(("unknown object type", f"{npc_id} (Type {r['Type']}, ShowType {r['ShowType']})"))
                continue
            if kind == "encounter":
                self._encounter(meets.get(int(npc_id)), note_id, note)
                continue
            entry = self._entry(note_id, note, kind)
            index[note_id] += 1
            if kind == "decryption":
                kind, extra = decryption_kind(entry["name"]["en"])
                if kind is None and boxes.get(npc_id, {}).get("BoxType") == 8:
                    # A guarded decryption chest: its guard is a boss (Suotuo's Wolf Thief Tyrant and Priest).
                    kind = "chest_boss"
                if kind is None:
                    self.skipped.append(("decryption chest of a kind the site has no type for",
                                         f"{npc_id} in '{entry['name']['en']}'"))
                    continue
                entry["kind"] = kind
            else:
                extra = {}
            if kind == "seed":
                self.skipped.append(("seeds are not exported yet (their number is not in these tables)", npc_id))
                continue
            npc = self.npc.get(npc_id)
            if npc is None:
                self.skipped.append(("no position in scene_static_npc", f"{npc_id} ({kind})"))
                continue
            item = self._item(kind, npc_id, game_xy(npc["BornPos"]), note=note_id, index=index[note_id],
                              height=npc["BornPos"][1])
            item["extra"].update(extra)
            if kind == "chest_normal":
                if boxes.get(npc_id, {}).get("BoxType") == 8:
                    item["tags"].add("guarded")
                if npc["Script"] == "ShowNpc":
                    item["tags"].add("hidden")
                desc = entry["desc"]["zh"]
                item["tags"].update(tag for word, tag in DESC_TAGS.items() if word in desc)
                if SEAL_HINT in desc:
                    item["seal"] = True
            if kind in ("teleport", "viewpoint"):
                item["name"] = site_name(self.t(f"Name_{npc_id}"))
        controllers = {r["ID"]: r for r in self.game.rows("discover_controller")}
        levels = defaultdict(list)
        for r in self.game.rows("discover_controller_level"):
            levels[r["ControllerId"]].append(r)
        for cid, layers in sorted(trials.items()):
            c = controllers.get(cid, {})
            npc = self.npc.get(c.get("TriggerNpc"))
            stages = sorted(levels.get(cid, []), key=lambda r: r["Level"])
            item = self._item("divine_trial", str(cid), game_xy(npc["BornPos"]) if npc else None,
                              height=npc["BornPos"][1] if npc else None,
                              name=site_name(self.t(c.get("GuideTitle", "")), trial=True))
            item["extra"]["subtype"] = TRIAL_SUBTYPES.get(c.get("Type"))
            item["stages"] = [{"stage": s["Level"], "stars": s["Star"],
                               "cp": int(s["CPValue"]) if str(s["CPValue"]).isdigit() else None} for s in stages]
            if len(stages) != layers:
                self.skipped.append(("trial layer count differs between tables",
                                     f"{cid}: {layers} in scene_explore, {len(stages)} in discover_controller_level"))
            if not npc:
                self.skipped.append(("no position for the trial's trigger NPC", f"{cid} ({c.get('TriggerNpc')})"))

    def _optional_rows(self, name):
        try:
            return self.game.rows(name)
        except FileNotFoundError:
            return []

    def _read_respawn(self):
        """The chests that appear, a single time, after every normal chest of the region is open (SPEC 4.5).
        Their entries are the site's own (not listed), one per group of the game, keyed by the entry id."""
        eye = {r["Id"] for r in self._optional_rows("magic_pupil_npc") if r["Type"] == 2}
        for r in self._optional_rows("activity_explore_value"):
            if r["SceneId"] != self.scene:
                continue
            npc_id = r["ActivityExploreId"]
            m = RESPAWN_ID.search(npc_id)
            if not m or m.group(1) not in RESPAWN_RARITIES:
                self.skipped.append(("respawned chest outside the known groups", npc_id))
                continue
            rarity, letter, number = m.group(1), m.group(2), int(m.group(3))
            key = f"respawn-{rarity}-{letter.lower()}"
            if key not in self.entries:
                self.entries[key] = {
                    "kind": "chest_respawn", "listed": False, "count": 0, "order": None,
                    "site_order": (RESPAWN_RARITIES.index(rarity), letter), "respawn": (rarity, letter),
                    "name": {lang: "" for lang in LANGS}, "desc": {lang: "" for lang in LANGS},
                }
            self.entries[key]["count"] += 1
            npc = self.npc.get(npc_id)
            if npc is None:
                self.skipped.append(("no position in scene_static_npc", f"{npc_id} (chest_respawn)"))
                continue
            item = self._item("chest_respawn", npc_id, game_xy(npc["BornPos"]), note=key, index=number,
                              height=npc["BornPos"][1])
            if npc_id in eye:
                item["tags"].add("purple_demon_eye")

    def _entry(self, note_id, note, kind):
        if note_id not in self.entries:
            listed = note is not None
            self.entries[note_id] = {
                "kind": kind, "listed": listed, "count": 0,
                "order": note["Order"] if listed else None,
                "name": site_name(self.t(note["NoteName"])) if listed else {lang: "" for lang in LANGS},
                "desc": self.t(note["NoteDesc"]) if listed else {lang: "" for lang in LANGS},
            }
        self.entries[note_id]["count"] += 1
        return self.entries[note_id]

    def _encounter(self, meet, note_id, note):
        if meet is None:
            self.skipped.append(("encounter missing from fortuitousmeet", str(note_id)))
            return
        mid = meet["FortuitousmeetId"]
        entry = self._entry(note_id, note, "encounter")
        entry["name"] = site_name(self.t(meet["FortuitousmeetName"]))
        if not any(entry["desc"].values()):
            entry["desc"] = self.t(meet.get("HandBookTips", ""))  # the description the encounter list shows
        entry["meet"] = mid
        types = str(meet["ConditionType"]).split(";")
        params = str(meet["ConditionParameter"]).split(";")
        values = str(meet["ConditionValue"]).split(";")
        points = []
        for kind, param in zip(types, params):
            npc = self.npc.get(param) if kind in NPC_TRIGGERS else None
            if npc:
                points.append(game_xy(npc["BornPos"]))
        if points and len(points) == len(types):
            item = self._item("encounter", f"meet {mid}", note=note_id)
            item["points"] = points
            return
        triggers = [f"{TRIGGER_NAMES.get(k, 'type ' + k)} {p} x{v}" for k, p, v in zip(types, params, values)]
        if any(k == "4" for k in types):
            names = self._item_names()
            triggers = [f"{tr} ({names.get(p, '?')})" if k == "4" else tr
                        for tr, k, p in zip(triggers, types, params)]
        self.skipped.append(("encounter without a position (its trigger is not an NPC)",
                             f"{entry['name']['en']}: {'; '.join(triggers)}"))

    def _item_names(self):
        en = self.text["en"]
        return {str(r["ItemId"]): clean(en.get(r["ItemName"], "")) for r in self.game.rows("item")}

    def _read_books(self):
        for npc_id, npc in sorted(self.npc.items()):
            m = re.fullmatch(r"npc_book_(\d+)", npc_id)
            if m:
                self._item("book", npc_id, game_xy(npc["BornPos"]), height=npc["BornPos"][1],
                           name=site_name(self.t(f"BookTitle_{m.group(1)}")))

    def _calibration(self):
        """Pixel = scale * game + offset for an image of size 1 (multiply scale and offset by its width)."""
        pos = next((r for r in self.game.rows("map_position") if r["Id"] == self.scene), None)
        if not pos:
            return None
        multiple = pos["MapDetailPictureMultiple"]
        size = pos["MapDetailPictureSize"][0]
        dx, dy = pos["MapDetailPicturePosition"]
        scale = 1 / (size * multiple)              # image widths per game unit
        cx, cy = HALF + dx / WORLD_MAP_SCALE, HALF + dy / WORLD_MAP_SCALE  # game point at the image centre
        return {"scaleX": scale, "offsetX": 0.5 - scale * cx, "scaleY": -scale, "offsetY": 0.5 + scale * cy}


def find_scene(game, map_id, root=ROOT):
    name = json.loads((root / "i18n" / "en.json").read_text(encoding="utf-8")).get(f"map.{map_id}")
    if not name:
        sys.exit(f"i18n/en.json has no map.{map_id}")
    en = game.texts("en")
    scenes = [r["Id"] for r in game.rows("scene_explore_control") if clean(en.get(r["Name"], "")) == name]
    if len(scenes) != 1:
        sys.exit(f"found {len(scenes)} game scenes named '{name}'")
    return scenes[0]


def calibration_for(region, width):
    c = region.calibration
    return c and {k: v * width for k, v in c.items()}


# ---------------------------------------------------------------------------------------------- export

# A site entry for objects the game counts but lists in no entry (SPEC §4.3, tag `unlisted`). The game gives
# them no name, so the owner adds the area to each name (e.g. "(south-west)").
UNLISTED = {
    "name": {"en": "Outside the game's list", "pt": "Fora da lista do jogo", "zh": "游戏列表之外"},
    "desc": {"en": "The game counts these chests among the region's normal chests but lists them in no entry "
                   "of its exploration list, so it cannot show which are left; mark them here.",
             "pt": "O jogo conta estes baús entre os baús comuns da região, mas não os lista em nenhuma entrada "
                   "da lista de exploração, então não mostra quais faltam; marque-os aqui.",
             "zh": "游戏将这些宝箱计入本区域的普通宝箱，但探索列表中没有对应条目，无法显示还剩哪些；可在此标记。"},
}


# The site's own entries for the respawned chests (chest_respawn), one per group of the game: "Common Chests A"
# for nd_Newactivitybox_normal_A_*, "Fine Chests B" for ..._good_B_*. The descriptions say what the game does
# not: when they appear and that nothing in the game counts them.
RESPAWN_TEXTS = {
    "name": {"normal": {"en": "Respawned Common Chests {}", "pt": "Baús Comuns Reaparecidos {}", "zh": "刷新普通宝箱{}"},
             "good": {"en": "Respawned Fine Chests {}", "pt": "Baús Refinados Reaparecidos {}", "zh": "刷新精良宝箱{}"}},
    "desc": {"en": "Once every normal chest of the region is open, these chests appear, a single time and "
                   "invisible: only the Purple Demon Eye shows them. The game counts them nowhere, so mark them here.",
             "pt": "Depois que todos os baús comuns da região são abertos, estes baús aparecem, uma única vez e "
                   "invisíveis: só o Olho Demoníaco Púrpura os mostra. O jogo não os conta em lugar nenhum, então "
                   "marque-os aqui.",
             "zh": "区域内所有普通宝箱开启后，这些宝箱会出现一次，且为隐形：只有紫极魔瞳能看到。游戏不会统计它们，可在此标记。"},
}


def note_key(note_id):
    """Sort key for the region's entries: the game's NoteIds, then the site's own (string keys)."""
    return (1, 0, note_id) if isinstance(note_id, str) else (0, note_id, "")


def entry_order(e):
    """Position of an entry in its type's list: the game's order, the unlisted ones last."""
    if "site_order" in e:
        return e["site_order"]
    return e.get("order") or 0 if e.get("listed", True) else float("inf")


def export(region, map_id, out_dir):
    entry_ids, entry_rows, todo = {}, [], []
    unlisted_n = 0
    by_note = defaultdict(list)
    for item in region.items:
        if "note" in item:
            by_note[item["note"]].append(item)
    for note_id, e in sorted(region.entries.items(), key=lambda kv: (TYPE_ORDER.index(kv[1]["kind"])
                                                                      if kv[1]["kind"] in TYPE_ORDER else 99,
                                                                      entry_order(kv[1]), note_key(kv[0]))):
        members = by_note.get(note_id, [])
        if not members:
            continue
        unlisted = not e["listed"] and e["kind"] not in ("encounter", "chest_respawn")
        if e.get("respawn"):
            rarity, letter = e["respawn"]
            e["name"] = {lang: text.format(letter) for lang, text in RESPAWN_TEXTS["name"][rarity].items()}
            e["desc"] = RESPAWN_TEXTS["desc"]
            eid = note_id
        elif unlisted:
            n = sum(1 for x in region.entries.values() if not x["listed"] and x["kind"] == e["kind"])
            unlisted_n += 1
            suffix = f" {unlisted_n}" if n > 1 else ""
            e["name"] = {lang: text + suffix for lang, text in UNLISTED["name"].items()}
            e["desc"] = UNLISTED["desc"]
            for i in members:
                i["tags"] = i["tags"] | {"unlisted"}
            eid = f"unlisted-{unlisted_n}"
            todo.append(f"{eid}: an entry the game does not list (NoteId {note_id}, {len(members)} {e['kind']}); "
                        "add its area to the names")
        else:
            eid = slug(e["name"]["en"], e["kind"])
        if eid in entry_ids.values():
            eid = f"{eid}-{note_id}"
        entry_ids[note_id] = eid
        common = set.intersection(*(i["tags"] for i in members)) if members else set()
        for i in members:
            i["own_tags"] = i["tags"] - common
        entry_rows.append({"id": eid, "type": e["kind"], "name_en": e["name"]["en"], "size": e["count"],
                           "tags": ";".join(sorted(common)), "name_pt": e["name"]["pt"], "name_zh": e["name"]["zh"],
                           "desc_en": e["desc"]["en"], "desc_pt": e["desc"]["pt"], "desc_zh": e["desc"]["zh"]})

    def order(item):
        e = region.entries.get(item.get("note"), {})
        return (TYPE_ORDER.index(item["type"]), entry_order(e), note_key(item.get("note") or 0),
                item.get("index") or 0, item["source"])

    exported = [i for i in region.items if not i.get("skip") and i["points"]]
    exported.sort(key=order)
    marker_rows, text_rows, stage_rows = [], [], []
    for n, item in enumerate(exported, 1):
        mid = f"{map_id}-{n:04d}"
        kind = item["type"]
        if kind == "chest_coop":
            todo.append(f"{mid}: players (chest_coop; required)")
        if item.get("seal"):
            todo.append(f"{mid}: tag poison_seal or fire_seal (Xuanyu Hand chest)")
        if item["extra"].get("subtype") == "combat":
            todo.append(f"{mid}: level of each of its {len(item['stages'])} stages in stages.csv (combat; required)")
        lists = kind not in ("encounter", "chest_coop", "chest_challenge", "chest_contract", "chest_boss")
        for x, y in item["points"]:
            row = dict.fromkeys(MARKER_HEADER, "")
            row.update(id=mid, type=kind, x=x, y=y, entry=entry_ids.get(item.get("note"), ""),
                       entry_index=item.get("index") if lists and "note" in item else "",
                       tags=";".join(sorted(item.get("own_tags", set()))))
            row.update({k: v for k, v in item["extra"].items() if v})
            marker_rows.append(row)
        if kind in TEXT_TYPES and item.get("name", {}).get("en"):
            text_rows.append({"marker": mid, "field": "name", **item["name"]})
        for s in item.get("stages", []):
            combat = item["extra"].get("subtype") == "combat"
            stage_rows.append({"trial": mid, "stage": s["stage"], "stars": s["stars"], "level": "",
                               "cp": s["cp"] if combat and s["cp"] is not None else ""})

    out_dir.mkdir(parents=True, exist_ok=True)
    write_csv(out_dir / "markers.csv", MARKER_HEADER, marker_rows)
    write_csv(out_dir / "entries.csv", ENTRY_HEADER, entry_rows)
    write_csv(out_dir / "marker_texts.csv", ["marker", "field", *LANGS], text_rows)
    write_csv(out_dir / "stages.csv", ["trial", "stage", "stars", "level", "cp"], stage_rows)
    return len(exported), len(entry_rows), todo


def write_csv(path, header, rows):
    with open(path, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=header, lineterminator="\n")
        w.writeheader()
        w.writerows(rows)


def read_csv(path):
    if not path.is_file():
        return []
    with open(path, encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


# --------------------------------------------------------------------------------------------- compare

# Respawned chests are a family of their own: most stand exactly where a normal chest stood.
CHESTS = {"chest_normal", "chest_coop", "chest_challenge", "chest_contract"}


def family(kind):
    return "chest" if kind in CHESTS else kind


def match(region, markers, tolerance=3):
    """Pair each CSV marker point with a game point of the same family, nearest first, one to one."""
    game_points = [(item, k, p) for item in region.items for k, p in enumerate(item["points"])]
    csv_points = [(n, m) for n, m in enumerate(markers) if m["x"] and m["y"]]
    pairs = []
    for n, m in csv_points:
        x, y = float(m["x"]), float(m["y"])
        for g, (item, k, (gx, gy)) in enumerate(game_points):
            if family(item["type"]) == family(m["type"]):
                d = max(abs(gx - x), abs(gy - y))
                if d <= tolerance:
                    pairs.append((d, n, g))
    pairs.sort()
    used_csv, used_game, matched = set(), set(), {}
    for d, n, g in pairs:
        if n in used_csv or g in used_game:
            continue
        used_csv.add(n)
        used_game.add(g)
        matched[n] = (game_points[g][0], d)
    missing = [(item, p) for g, (item, k, p) in enumerate(game_points) if g not in used_game]
    extra = [markers[n] for n, _ in csv_points if n not in used_csv]
    return matched, missing, extra


def compare(region, map_id, src_dir, maps):
    out = []
    say = out.append
    markers = read_csv(src_dir / "markers.csv")
    entries = {e["id"]: e for e in read_csv(src_dir / "entries.csv")}
    texts = {(t["marker"], t["field"]): t for t in read_csv(src_dir / "marker_texts.csv")}
    stages = defaultdict(dict)
    for s in read_csv(src_dir / "stages.csv"):
        stages[s["trial"]][int(s["stage"])] = s
    matched, missing, extra = match(region, markers)

    dist = Counter(min(int(d), 2) for _, d in matched.values())
    say(f"Positions: {len(matched)} CSV points found in the game: {dist[0]} exact, {dist[1]} off by 1, "
        f"{dist[2]} off by 2-3 (game coordinates are rounded from the NPC's spawn point).")
    far = [(markers[n], item, d) for n, (item, d) in matched.items() if d > 1]
    for m, item, d in far:
        say(f"  off by {d:g}: {m['id']} {m['type']} ({m['x']}, {m['y']}) vs game {item['points']}")

    section = lambda title, lines: (say(f"\n{title}: {len(lines)}"), [say("  " + line) for line in lines])
    section("In the game, not in the CSV", [
        f"{item['type']} {item['source']} at {p}"
        + (f", entry '{region.entries[item['note']]['name']['en'] or 'NoteId ' + str(item['note'])}'"
           if item.get("note") in region.entries else "")
        + ("" if region.entries.get(item.get("note"), {}).get("listed", True) else " (an entry the game does not list)")
        for item, p in missing])
    section("In the CSV, not found in the game data", [f"{m['id']} {m['type']} ({m['x']}, {m['y']})" for m in extra])

    note_entry = {}
    problems = []
    for n, (item, d) in matched.items():
        m = markers[n]
        if m["type"] != item["type"]:
            problems.append(f"{m['id']}: type {m['type']} in the CSV, {item['type']} in the game")
        for key, value in item["extra"].items():
            if value and m.get(key) != value:
                problems.append(f"{m['id']}: {key} '{m.get(key)}' in the CSV, '{value}' in the game")
        note = item.get("note")
        if note is not None and m["entry"]:
            note_entry.setdefault(note, Counter())[m["entry"]] += 1
            e = region.entries[note]
            csv_name = entries.get(m["entry"], {}).get("name_en", "")
            if e["listed"] and csv_name != e["name"]["en"]:
                problems.append(f"{m['id']}: in entry '{csv_name}' in the CSV, '{e['name']['en']}' in the game")
            if m["entry_index"] and item.get("index") and int(m["entry_index"]) != item["index"]:
                problems.append(f"{m['id']}: entry_index {m['entry_index']} in the CSV, {item['index']} in the game")
        if m["type"] in ("chest_normal", "chest_respawn"):
            have = set(filter(None, m["tags"].split(";"))) | set(filter(None, entries.get(m["entry"], {}).get("tags", "").split(";")))
            # Only this way round: a CSV tag the game does not tell may be about where that one chest is.
            for tag in sorted((item["tags"] - have) & DERIVED_TAGS):
                problems.append(f"{m['id']}: the game says '{tag}', the CSV does not")
            if item.get("seal") and not have & {"poison_seal", "fire_seal"}:
                problems.append(f"{m['id']}: a Xuanyu Hand chest without poison_seal or fire_seal")
    section("Marker differences", problems)

    problems = []
    seen = set()
    by_name = {(row["type"], row["name_en"]): eid for eid, row in entries.items()}
    for note, e in sorted(region.entries.items(), key=lambda kv: note_key(kv[0])):
        ids = note_entry.get(note)
        if not ids and (e["kind"], e["name"]["en"]) in by_name:
            # an entry whose objects have no position in the tables (most encounters): match it by name
            note_entry[note] = ids = Counter({by_name[(e["kind"], e["name"]["en"])]: 1})
        if not ids:
            if e["listed"]:
                problems.append(f"game entry '{e['name']['en']}' ({e['kind']}, {e['count']}) has no marker in the CSV")
            continue
        eid = ids.most_common(1)[0][0]
        seen.add(eid)
        row = entries.get(eid)
        if not row:
            continue
        if e["kind"] != "encounter" and int(row["size"]) != e["count"]:
            problems.append(f"{eid}: size {row['size']} in the CSV, {e['count']} in the game")
        for lang in LANGS:
            for field, value in (("name", e["name"][lang]), ("desc", e["desc"][lang])):
                mine = row.get(f"{field}_{lang}", "")
                if value and mine and clean(mine) != value:
                    problems.append(f"{eid}: {field}_{lang} '{mine}' in the CSV, '{value}' in the game")
                elif value and not mine:
                    problems.append(f"{eid}: {field}_{lang} empty in the CSV, the game has '{value}'")
    csv_order = [eid for eid in entries if eid in seen]
    note_of = {note_entry[n].most_common(1)[0][0]: n for n in note_entry}
    game_order = sorted(csv_order, key=lambda eid: (region.entries[note_of[eid]]["kind"] != entries[eid]["type"],
                                                    entries[eid]["type"], entry_order(region.entries[note_of[eid]])))
    for kind in dict.fromkeys(entries[eid]["type"] for eid in csv_order):
        mine = [eid for eid in csv_order if entries[eid]["type"] == kind]
        theirs = [eid for eid in game_order if entries[eid]["type"] == kind]
        if mine != theirs and kind != "encounter":
            problems.append(f"{kind} entries are in a different order from the game's: game order {theirs}")
    section("Entry differences", problems)

    problems = []
    for n, (item, d) in matched.items():
        m = markers[n]
        if item.get("name") and m["type"] in TEXT_TYPES:
            row = texts.get((m["id"], "name"), {})
            for lang in LANGS:
                if item["name"][lang] and clean(row.get(lang, "")) != item["name"][lang]:
                    problems.append(f"{m['id']} name_{lang}: '{row.get(lang, '')}' in the CSV, '{item['name'][lang]}' in the game")
        if item["type"] == "divine_trial":
            mine = stages.get(m["id"], {})
            if len(mine) != len(item["stages"]):
                problems.append(f"{m['id']}: {len(mine)} stages in the CSV, {len(item['stages'])} in the game")
            for s in item["stages"]:
                row = mine.get(s["stage"])
                if not row:
                    continue
                if int(row["stars"]) != s["stars"]:
                    problems.append(f"{m['id']} stage {s['stage']}: {row['stars']} stars in the CSV, {s['stars']} in the game")
                if s["cp"] is not None and m["subtype"] == "combat":
                    if not row["cp"]:
                        problems.append(f"{m['id']} stage {s['stage']}: no CP in the CSV, the game recommends {s['cp']}")
                    elif int(row["cp"]) != s["cp"]:
                        problems.append(f"{m['id']} stage {s['stage']}: CP {row['cp']} in the CSV, {s['cp']} in the game")
    section("Name and trial stage differences", problems)

    cfg = maps.get(map_id, {})
    problems = []
    if region.milestones and cfg.get("exploration", {}).get("milestones") != region.milestones:
        problems.append(f"milestones in maps.json {cfg.get('exploration', {}).get('milestones')}, game {region.milestones}")
    width = cfg.get("image", {}).get("width")
    official = calibration_for(region, width) if width else None
    mine = cfg.get("calibration", {})
    if official and any(abs((mine.get(k) or 0) - v) > 1e-3 for k, v in official.items()):
        problems.append("calibration in maps.json " + ", ".join(f"{k}={mine.get(k)}" for k in official)
                        + "; from the game " + ", ".join(f"{k}={v:.4f}" for k, v in official.items()))
    section(f"Region (exploration value cap in the game: {region.value_cap})", problems)
    section("Not exported or not checkable from the game data", [f"{why}: {what}" for why, what in region.skipped])
    say("\nNot in the game tables, so not compared: tags other than guarded, purple_demon_eye and hidden; players;"
        " pillar_x/pillar_y; combat stage levels; marker notes and howtos; links; portals and their destination.")
    return "\n".join(out)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("command", choices=["export", "compare"])
    ap.add_argument("map")
    ap.add_argument("--game", required=True, help="the game folder that holds BuildRes/ and Res/")
    ap.add_argument("--root", default=str(ROOT), help=argparse.SUPPRESS)
    args = ap.parse_args()
    root = Path(args.root)
    game = GameFiles(args.game)
    scene = find_scene(game, args.map, root)
    region = Region(game, scene)
    src = root / "data" / "src" / args.map
    maps = json.loads((root / "data" / "maps.json").read_text(encoding="utf-8"))
    print(f"{args.map}: game scene {scene}")
    if args.command == "export":
        if read_csv(src / "markers.csv"):
            sys.exit(f"{src / 'markers.csv'} already has rows; use compare (export only fills an empty map)")
        n_markers, n_entries, todo = export(region, args.map, src)
        print(f"wrote {n_markers} markers and {n_entries} entries to {src}")
        for why, what in region.skipped:
            print(f"  left out, {why}: {what}")
        for line in todo:
            print(f"  to fill in: {line}")
        if region.milestones:
            print(f"exploration milestones (maps.json): {region.milestones}; value cap {region.value_cap}")
        width = maps.get(args.map, {}).get("image", {}).get("width")
        if width:
            print("calibration from the game: " + json.dumps({k: round(v, 6) for k, v in calibration_for(region, width).items()}))
    else:
        print(compare(region, args.map, src, maps))


if __name__ == "__main__":
    main()
