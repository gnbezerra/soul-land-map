"""Tests for tools/game_tables.py and tools/game_data.py.

Run with: python -m unittest discover -s tests

The game folder is made up: a few .xc tables written by encode_table() below (the inverse of the reader) in a
temporary directory, so the tests need neither the game nor the real CSVs. The command line runs with --root
on a temporary project.
"""
import csv
import json
import struct
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "tools"))
import game_data  # noqa: E402
from game_tables import FormatError, GameFiles, parse_table  # noqa: E402

TOOL = REPO / "tools" / "game_data.py"
SCENE = 9


# ------------------------------------------------------------------------------------------ .xc writer

def encode_value(v):
    if isinstance(v, bool) or isinstance(v, int):
        v = int(v)
        if v == 0:
            return b"\x00"
        n = max(1, (v.bit_length() + 7) // 8)
        return bytes([n]) + v.to_bytes(n, "big")
    if isinstance(v, float):
        return b"\x05" + struct.pack(">f", v)
    if isinstance(v, list):
        return (b"\x07" if len(v) == 2 else b"\x08") + struct.pack(f">{len(v)}f", *v)
    data = v.encode("utf-8")
    if not data:
        return b"\x06"
    if len(data) > 127:
        return b"\x26" + len(data).to_bytes(2, "big") + data
    return b"\x16" + bytes([len(data)]) + data


def encode_table(columns, rows):
    """columns: [(name, type)]; rows: [dict]."""
    header = b"".join(encode_value(x) for x in [f"desc {n}" for n, _ in columns] + [t for _, t in columns]
                      + [n for n, _ in columns])
    body = b""
    for row in rows:
        values = b"".join(encode_value(row.get(n, 0 if t in ("int", "bool") else "")) for n, t in columns)
        body += (len(values) + 2).to_bytes(2, "big") + values
    data = header + body
    return b"LRGB" + struct.pack(">6I", len(columns), len(rows) + 3, 0, 0, 0, len(body)) + data


def cols(spec):
    return [tuple(c.split(":")) if ":" in c else (c, "int") for c in spec.split()]


# ------------------------------------------------------------------------------------------- fixture

def npc(npc_id, x, y, script="TreasureBox", height=10.0, scene=SCENE):
    return {"SceneID": scene, "NpcID": npc_id, "Script": script, "BornPos": [x - 512.0, height, y - 512.0]}


TABLES = {
    "scene_explore_control": (cols("Id Name:string ExploreValueMax Push:string"),
                              [{"Id": SCENE, "Name": "MapName9", "ExploreValueMax": 300, "Push": "10;20;30"}]),
    "map_position": (cols("Id MapMaxPos:vector2 MapDetailPictureSize:vector2 MapDetailPictureMultiple:float "
                          "MapDetailPicturePosition:vector2"),
                     [{"Id": SCENE, "MapMaxPos": [1024.0, 1024.0], "MapDetailPictureSize": [4096.0, 4096.0],
                       "MapDetailPictureMultiple": 0.25, "MapDetailPicturePosition": [23.0, -46.0]}]),
    "scene_explore": (cols("Id exploreId SceneId Type ShowType NpcId:string ExploreValue NoteId"), [
        # Chests of "Lake Chest One", listed in reverse to check the order follows the table rows.
        {"Id": 1, "SceneId": SCENE, "Type": 1, "ShowType": 1, "NpcId": "box_a", "NoteId": 101},
        {"Id": 2, "SceneId": SCENE, "Type": 1, "ShowType": 1, "NpcId": "box_b", "NoteId": 101},
        {"Id": 3, "SceneId": SCENE, "Type": 1, "ShowType": 1, "NpcId": "box_g", "NoteId": 102},
        {"Id": 4, "SceneId": SCENE, "Type": 1, "ShowType": 1, "NpcId": "box_orphan", "NoteId": 199},
        {"Id": 5, "SceneId": SCENE, "Type": 1, "ShowType": 2, "NpcId": "box_coop", "NoteId": 110},
        {"Id": 6, "SceneId": SCENE, "Type": 1, "ShowType": 2, "NpcId": "box_frost", "NoteId": 111},
        {"Id": 7, "SceneId": SCENE, "Type": 1, "ShowType": 2, "NpcId": "box_boss", "NoteId": 112},
        {"Id": 8, "SceneId": SCENE, "Type": 2, "ShowType": 3, "NpcId": "2009001_1", "NoteId": 0},
        {"Id": 9, "SceneId": SCENE, "Type": 2, "ShowType": 3, "NpcId": "2009001_2", "NoteId": 0},
        {"Id": 10, "SceneId": SCENE, "Type": 2, "ShowType": 3, "NpcId": "2009001_3", "NoteId": 0},
        {"Id": 11, "SceneId": SCENE, "Type": 3, "ShowType": 6, "NpcId": "tp_1", "NoteId": 301},
        {"Id": 12, "SceneId": SCENE, "Type": 7, "ShowType": 5, "NpcId": "1", "NoteId": 701},
        {"Id": 13, "SceneId": SCENE, "Type": 7, "ShowType": 5, "NpcId": "2", "NoteId": 702},
        {"Id": 14, "SceneId": SCENE, "Type": 1, "ShowType": 1, "NpcId": "box_tang", "NoteId": 103},
        {"Id": 15, "SceneId": 5, "Type": 1, "ShowType": 1, "NpcId": "box_other_scene", "NoteId": 101},
    ]),
    "scene_explore_note": (cols("Id Type ShowType Scene Order NoteName:string NoteDesc:string"), [
        {"Id": 101, "Order": 2, "NoteName": "N101", "NoteDesc": "D101"},
        {"Id": 102, "Order": 1, "NoteName": "N102", "NoteDesc": "D102"},
        {"Id": 103, "Order": 3, "NoteName": "N103", "NoteDesc": "D103"},
        {"Id": 110, "Order": 4, "NoteName": "N110"},
        {"Id": 111, "Order": 5, "NoteName": "N111"},
        {"Id": 112, "Order": 6, "NoteName": "N112"},
        {"Id": 301, "Order": 7, "NoteName": "N301"},
        {"Id": 701, "Order": 8},
        {"Id": 702, "Order": 9},
    ]),
    "scene_static_npc": (cols("Id SceneID NpcID:string Script:string BornPos:vector3"), [
        npc("box_a", 100, 200), npc("box_b", 110.5, 210.4), npc("box_g", 300, 300),
        npc("box_orphan", 400, 400), npc("box_coop", 500, 500), npc("box_frost", 510, 510),
        npc("box_boss", 520, 520), npc("box_tang", 530, 530), npc("ts_trial", 600, 600, "ShowNpc"),
        npc("tp_1", 700, 700, "ShowNpc"), npc("meet_npc_1", 800, 800, "ShowNpc"),
        npc("meet_npc_2", 810, 790, "ShowNpc"), npc("npc_book_90101", 900, 900, "ShowNpc"),
        npc("box_a", 1, 1, scene=5),
    ]),
    "box_npc": (cols("Id:string BoxType BoxRare"), [
        {"Id": "box_a", "BoxType": 5, "BoxRare": 1}, {"Id": "box_g", "BoxType": 8, "BoxRare": 1},
        {"Id": "box_tang", "BoxType": 5, "BoxRare": 2},
    ]),
    "fortuitousmeet": (cols("FortuitousmeetId ConditionType:string ConditionParameter:string "
                            "ConditionValue:string FortuitousmeetName:string HandBookTips:string"), [
        {"FortuitousmeetId": 1, "ConditionType": "1;12", "ConditionParameter": "meet_npc_1;meet_npc_2",
         "ConditionValue": "1;1", "FortuitousmeetName": "Meet1"},
        {"FortuitousmeetId": 2, "ConditionType": "4", "ConditionParameter": "777", "ConditionValue": "3",
         "FortuitousmeetName": "Meet2", "HandBookTips": "Tips2"},
    ]),
    "item": (cols("ItemId:string ItemName:string"), [{"ItemId": "777", "ItemName": "Item777"}]),
    "discover_controller": (cols("ID TriggerNpc:string Type GuideTitle:string"),
                            [{"ID": 2009001, "TriggerNpc": "ts_trial", "Type": 1, "GuideTitle": "TrialName"}]),
    "discover_controller_level": (cols("SID ControllerId Level Condition:string CPValue:string Star"), [
        {"SID": 3, "ControllerId": 2009001, "Level": 3, "CPValue": "3000", "Star": 3},
        {"SID": 1, "ControllerId": 2009001, "Level": 1, "CPValue": "1000", "Star": 1},
        {"SID": 2, "ControllerId": 2009001, "Level": 2, "CPValue": "2000", "Star": 2},
    ]),
}
TEXTS = {
    "MapName9": "Test Region", "N101": "Lake Chest One", "D101": "Find the lake chests.",
    "N102": "Guardian Chest", "D102": "Guarded.", "N103": "Tang Sect Chest One", "D103": "Tang.",
    "N110": "Cooperative Chest One", "N111": "Mysterious Frost Coffer I", "N112": "Boss Chest",
    "N301": "Light Up! Teleport", "Name_tp_1": "North Teleport Point", "Meet1": "Two Friends",
    "Meet2": "Lost Items", "Item777": "Old Coin", "TrialName": "Trial of Strength: Test.", "Tips2": "Someone lost coins.", "BookTitle_90101": "A Book",
}
ZH = {**TEXTS, "D103": "使用钩爪，找到唐门宝箱。"}


def make_game(root, tables=TABLES):
    config = root / "BuildRes" / "config"
    config.mkdir(parents=True)
    for name, (columns, rows) in tables.items():
        (config / f"{name}.xc").write_bytes(encode_table(columns, rows))
    for name, texts in (("language_english", TEXTS), ("language_portuguese", {k: f"pt {v}" for k, v in TEXTS.items()}),
                        ("language", ZH)):
        rows = [{"Id": k, "Zhs": v} for k, v in texts.items()]
        (config / f"{name}.xc").write_bytes(encode_table(cols("Id:string Zhs:string"), rows))
    return GameFiles(root)


def make_project(root, map_id="testmap"):
    (root / "i18n").mkdir(parents=True)
    (root / "i18n" / "en.json").write_text(json.dumps({f"map.{map_id}": "Test Region"}), encoding="utf-8")
    (root / "data").mkdir()
    (root / "data" / "maps.json").write_text(json.dumps({map_id: {"image": {"width": 1000, "height": 1000},
                                                                  "exploration": {"milestones": [10, 20, 30]}}}),
                                             encoding="utf-8")


def read_rows(path):
    with open(path, encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


# ------------------------------------------------------------------------------------------------ tests

class TableFormat(unittest.TestCase):
    def test_round_trip_of_every_value_kind(self):
        columns = cols("a b:string c:float d:vector2 e:vector3 f:string g")
        long_text = "长" * 60  # 180 bytes: the u16-length string tag
        rows = [{"a": 0, "b": "", "c": 1.5, "d": [1.0, -2.0], "e": [0.5, 1.0, 2.0], "f": long_text, "g": 70000},
                {"a": 255, "b": "x", "c": 0.0, "d": [0.0, 0.0], "e": [0.0, 0.0, 0.0], "f": "y", "g": 1}]
        table = parse_table(encode_table(columns, rows))
        self.assertEqual(table["columns"], ["a", "b", "c", "d", "e", "f", "g"])
        self.assertEqual(table["types"][3], "vector2")
        self.assertEqual(table["rows"], rows)

    def test_rejects_damaged_files(self):
        good = encode_table(cols("a"), [{"a": 1}])
        with self.assertRaisesRegex(FormatError, "magic"):
            parse_table(b"XXXX" + good[4:])
        with self.assertRaisesRegex(FormatError, "data size"):
            parse_table(good + b"\x00")
        bad_length = bytearray(good)
        bad_length[-3] += 1  # the row's declared length (low byte)
        with self.assertRaisesRegex(FormatError, "declares"):
            parse_table(bytes(bad_length))
        unknown = bytearray(good)
        unknown[-2] = 0x09  # the value's tag
        with self.assertRaisesRegex(FormatError, "unknown value tag 0x09"):
            parse_table(bytes(unknown))

    def test_the_newer_copy_of_a_table_wins(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for base, value in (("BuildRes", 1), ("Res", 2)):
                (root / base / "config").mkdir(parents=True)
                (root / base / "config" / "t.xc").write_bytes(encode_table(cols("a"), [{"a": value}]))
            lists = {"BuildRes/internal_file_list.txt": "config/t.xc\t402\t1\tx\t402/config/t.xc\t0\n",
                     "Res/external_file_list.txt": "config/t.xc\t300\t1\tx\t300/config/t.xc\t1\n"}
            for path, text in lists.items():
                (root / path).write_text(text, encoding="utf-8")
            self.assertEqual(GameFiles(root).rows("t"), [{"a": 1}])
            (root / "Res/external_file_list.txt").write_text("config/t.xc\t460\t1\tx\t431/config/t.xc\t1\n",
                                                             encoding="utf-8")
            self.assertEqual(GameFiles(root).rows("t"), [{"a": 2}])


class Helpers(unittest.TestCase):
    def test_slugs_follow_the_existing_entry_ids(self):
        cases = [("Nuoding Academy Chest One", "chest_normal", "nuoding-academy-1"),
                 ("Wind Rest Plains Chest", "chest_normal", "wind-rest-plains"),
                 ("Pillar of Empty Path I", "chest_challenge", "pillar-empty-path-1"),
                 ("Cooperative Chest Two", "chest_coop", "coop-2"),
                 ("Hidden Chest III", "chest_normal", "hidden-3"),
                 ("Andy's Dilemma", "encounter", "andys-dilemma"),
                 ("King of Onlookers", "encounter", "king-of-onlookers"),
                 ("Light Up! Teleport", "teleport", "light-up-teleport"),
                 ("Shrine Crystal", "crystal", "shrine-crystal")]
        for name, kind, want in cases:
            self.assertEqual(game_data.slug(name, kind), want, name)

    def test_site_names_drop_the_closing_period_and_use_a_colon_in_trials(self):
        name = {"en": "Trial of Strength: Choice.", "pt": "Provação da Força · Escolha.", "zh": "力之试炼·抉择"}
        self.assertEqual(game_data.site_name(name, trial=True),
                         {"en": "Trial of Strength: Choice", "pt": "Provação da Força: Escolha", "zh": "力之试炼·抉择"})
        self.assertEqual(game_data.site_name({"en": "Wait...", "pt": "Um · Dois.", "zh": "。"}),
                         {"en": "Wait...", "pt": "Um · Dois", "zh": "。"})

    def test_coordinates_round_half_to_even_like_unity(self):
        self.assertEqual(game_data.game_xy([-411.5, 0, 0.4]), (100, 512))
        self.assertEqual(game_data.game_xy([-410.5, 0, -0.6]), (102, 511))


class Extraction(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.region = game_data.Region(make_game(Path(self.tmp.name)), SCENE)

    def tearDown(self):
        self.tmp.cleanup()

    def items(self, kind):
        return [i for i in self.region.items if i["type"] == kind]

    def test_chests_with_their_entry_position_index_and_tags(self):
        chests = {i["source"]: i for i in self.items("chest_normal")}
        self.assertEqual(set(chests), {"box_a", "box_b", "box_g", "box_orphan", "box_tang"})
        self.assertEqual(chests["box_b"]["points"], [(110, 210)])  # 110.5 rounds to even
        self.assertEqual((chests["box_a"]["index"], chests["box_b"]["index"]), (1, 2))
        self.assertEqual(chests["box_g"]["tags"], {"guarded"})
        self.assertEqual(chests["box_tang"]["tags"], {"grappling_hook"})  # from the Chinese description
        self.assertEqual(chests["box_a"]["tags"], set())
        self.assertFalse(self.region.entries[199]["listed"])

    def test_decryption_chests_by_entry_name(self):
        self.assertEqual([i["source"] for i in self.items("chest_coop")], ["box_coop"])
        self.assertEqual([i["extra"] for i in self.items("chest_contract")], [{"contract": "frost"}])
        self.assertIn(("decryption chest of a kind the site has no type for", "box_boss in 'Boss Chest'"),
                      self.region.skipped)

    def test_trials_teleports_books_and_encounters(self):
        [trial] = self.items("divine_trial")
        self.assertEqual((trial["points"], trial["extra"]["subtype"], trial["name"]["en"]),
                         ([(600, 600)], "combat", "Trial of Strength: Test"))
        self.assertEqual(trial["stages"], [{"stage": 1, "stars": 1, "cp": 1000}, {"stage": 2, "stars": 2, "cp": 2000},
                                           {"stage": 3, "stars": 3, "cp": 3000}])
        [tp] = self.items("teleport")
        self.assertEqual(tp["name"], {"en": "North Teleport Point", "pt": "pt North Teleport Point",
                                      "zh": "North Teleport Point"})
        [book] = self.items("book")
        self.assertEqual((book["points"], book["name"]["en"]), ([(900, 900)], "A Book"))
        [meet] = self.items("encounter")
        self.assertEqual(meet["points"], [(800, 800), (810, 790)])
        self.assertIn(("encounter without a position (its trigger is not an NPC)", "Lost Items: item 777 x3 (Old Coin)"),
                      self.region.skipped)
        self.assertEqual(self.region.entries[702]["desc"]["en"], "Someone lost coins.")  # from HandBookTips

    def test_region_values_and_calibration(self):
        self.assertEqual((self.region.value_cap, self.region.milestones), (300, [10, 20, 30]))
        # 0.25 x 4096 = 1024 game units across the image; centre at (512 + 23/2.3, 512 - 46/2.3) = (522, 492).
        cal = game_data.calibration_for(self.region, 1024)
        self.assertAlmostEqual(cal["scaleX"], 1.0)
        self.assertAlmostEqual(cal["offsetX"], 512 - 522)
        self.assertAlmostEqual(cal["scaleY"], -1.0)
        self.assertAlmostEqual(cal["offsetY"], 512 + 492)


class CommandLine(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name) / "project"
        self.game = Path(self.tmp.name) / "game"
        make_project(self.root)
        make_game(self.game)
        self.src = self.root / "data" / "src" / "testmap"

    def tearDown(self):
        self.tmp.cleanup()

    def run_tool(self, *args):
        p = subprocess.run([sys.executable, str(TOOL), *args, "testmap", "--game", str(self.game),
                            "--root", str(self.root)], capture_output=True, text=True, encoding="utf-8")
        return p.returncode, p.stdout + p.stderr

    def test_export_writes_the_csvs_and_lists_what_is_missing(self):
        code, out = self.run_tool("export")
        self.assertEqual(code, 0, out)
        entries = read_rows(self.src / "entries.csv")
        # Chest entries in the game's order (Order), the unlisted one left out; then decryption, teleports...
        self.assertEqual([e["id"] for e in entries],
                         ["guardian", "lake-1", "tang-sect-1", "coop-1", "mysterious-frost-coffer-1",
                          "two-friends", "light-up-teleport"])
        self.assertEqual(entries[0]["tags"], "guarded")
        self.assertEqual(entries[1]["name_pt"], "pt Lake Chest One")
        markers = read_rows(self.src / "markers.csv")
        self.assertEqual([(m["id"], m["type"], m["entry"], m["entry_index"], m["x"], m["y"]) for m in markers[:3]],
                         [("testmap-0001", "chest_normal", "guardian", "1", "300", "300"),
                          ("testmap-0002", "chest_normal", "lake-1", "1", "100", "200"),
                          ("testmap-0003", "chest_normal", "lake-1", "2", "110", "210")])
        meet = [m for m in markers if m["type"] == "encounter"]
        self.assertEqual([(m["id"], m["x"]) for m in meet], [("testmap-0008", "800"), ("testmap-0008", "810")])
        self.assertEqual(read_rows(self.src / "stages.csv")[0], {"trial": "testmap-0007", "stage": "1", "stars": "1",
                                                                 "level": "", "cp": "1000"})
        texts = read_rows(self.src / "marker_texts.csv")
        self.assertEqual({t["marker"]: t["en"] for t in texts},
                         {"testmap-0007": "Trial of Strength: Test", "testmap-0009": "North Teleport Point",
                          "testmap-0010": "A Book"})
        self.assertIn("1 chest_normal of NoteId 199: box_orphan (400, 400)", out)
        self.assertIn("to fill in: testmap-0005: players", out)
        self.assertIn("to fill in: testmap-0007: level of each of its 3 stages", out)

    def test_export_never_overwrites_a_map_with_markers(self):
        self.src.mkdir(parents=True)
        (self.src / "markers.csv").write_text("id,type,x,y\ntestmap-0001,book,1,1\n", encoding="utf-8")
        code, out = self.run_tool("export")
        self.assertNotEqual(code, 0)
        self.assertIn("already has rows", out)
        self.assertEqual(len(read_rows(self.src / "markers.csv")), 1)

    def test_compare_reports_each_kind_of_difference(self):
        self.assertEqual(self.run_tool("export")[0], 0)
        markers = read_rows(self.src / "markers.csv")
        by_id = {m["id"]: m for m in markers}
        by_id["testmap-0002"]["x"] = "101"           # off by 1: counted, not listed
        by_id["testmap-0003"]["x"] = "112"           # off by 2: listed
        by_id["testmap-0003"]["entry_index"] = "3"
        markers = [m for m in markers if m["id"] != "testmap-0010"]  # the book goes missing
        markers.append({**by_id["testmap-0001"], "id": "testmap-0099", "x": "50", "y": "50"})  # not in the game
        game_data.write_csv(self.src / "markers.csv", game_data.MARKER_HEADER, markers)
        entries = read_rows(self.src / "entries.csv")
        entries[1]["size"] = "3"
        entries[1]["desc_en"] = "Old text."
        entries[0]["tags"] = ""
        game_data.write_csv(self.src / "entries.csv", game_data.ENTRY_HEADER, entries)
        # An encounter with no position, added by hand: compared by its name.
        entries.append({**entries[-2], "id": "lost-items", "name_en": "Lost Items", "desc_en": "Coins.",
                        "desc_pt": "", "desc_zh": ""})
        game_data.write_csv(self.src / "entries.csv", game_data.ENTRY_HEADER, entries)
        stages = read_rows(self.src / "stages.csv")
        stages[1]["stars"] = "5"
        game_data.write_csv(self.src / "stages.csv", ["trial", "stage", "stars", "level", "cp"], stages)
        code, out = self.run_tool("compare")
        self.assertEqual(code, 0, out)
        for line in ["1 off by 1",
                     "off by 2: testmap-0003 chest_normal (112, 210) vs game [(110, 210)]",
                     "book npc_book_90101 at (900, 900)",
                     "chest_normal box_orphan at (400, 400), entry 'NoteId 199' (an entry the game does not list)",
                     "testmap-0099 chest_normal (50, 50)",
                     "testmap-0003: entry_index 3 in the CSV, 2 in the game",
                     "testmap-0001: the game says 'guarded', the CSV does not",
                     "lake-1: size 3 in the CSV, 2 in the game",
                     "lake-1: desc_en 'Old text.' in the CSV, 'Find the lake chests.' in the game",
                     "testmap-0007 stage 2: 5 stars in the CSV, 2 in the game",
                     "lost-items: desc_en 'Coins.' in the CSV, 'Someone lost coins.' in the game",
                     "lost-items: desc_pt empty in the CSV, the game has 'pt Someone lost coins.'",
                     "calibration in maps.json"]:
            self.assertIn(line, out)
        self.assertNotIn("milestones in maps.json", out)
        self.assertNotIn("Trial of Strength: Test.", out)  # the site's wording is not a difference

    def test_compare_accepts_the_official_calibration(self):
        self.assertEqual(self.run_tool("export")[0], 0)
        maps_path = self.root / "data" / "maps.json"
        maps = json.loads(maps_path.read_text(encoding="utf-8"))
        # 1000 px wide: scale 1000/1024; centre (522, 492) at 500 px.
        k = 1000 / 1024
        maps["testmap"]["calibration"] = {"scaleX": k, "offsetX": 500 - k * 522, "scaleY": -k, "offsetY": 500 + k * 492}
        maps_path.write_text(json.dumps(maps), encoding="utf-8")
        code, out = self.run_tool("compare")
        self.assertEqual(code, 0, out)
        self.assertNotIn("calibration in maps.json", out)


if __name__ == "__main__":
    unittest.main()
