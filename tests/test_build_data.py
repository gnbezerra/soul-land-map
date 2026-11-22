"""Tests for tools/build_data.py.

Run with: python -m unittest discover -s tests

Each test writes a small made-up project into a temporary directory and runs the real command line on it
with --root, so the real CSVs under data/src/ are never read or written. The base fixture builds with no
errors and no warnings; each case changes one thing and checks the message it produces.
"""
import copy
import csv
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
BUILD = REPO / "tools" / "build_data.py"
MAP = "testmap"

# Image 1000x1000 and a calibration that maps game (x, y) to pixel (x, 1000 - y).
MAPS = {
    MAP: {"image": {"width": 1000, "height": 1000},
          "calibration": {"scaleX": 1, "offsetX": 0, "scaleY": -1, "offsetY": 1000}},
    "othermap": {"image": {"width": 1000, "height": 1000}, "calibration": {}},
}
# Rows are in a deliberate order: entries "chests-b" before "chests-a" (the output keeps the CSV order),
# markers not sorted by id (the output is sorted), stages shuffled (the output is in stage order).
ENTRIES = [
    {"id": "chests-b", "type": "chest_normal", "name_en": "Chest Set B", "size": "2",
     "name_pt": "Baús B", "name_zh": "宝箱B", "desc_en": "Two chests."},
    {"id": "chests-a", "type": "chest_normal", "name_en": "Chest Set A", "size": "1", "tags": "grappling_hook"},
    {"id": "crystals", "type": "crystal", "name_en": "Crystals", "size": "1"},
    {"id": "quest", "type": "encounter", "name_en": "The Quest", "size": "1"},
    {"id": "teleports", "type": "teleport", "name_en": "Teleports", "size": "1"},
    {"id": "seeds", "type": "seed", "name_en": "Seeds", "size": "1"},
]
MARKERS = [
    {"id": "testmap-0002", "type": "chest_normal", "x": "100", "y": "100", "entry": "chests-b",
     "entry_index": "1", "links": "testmap-0001"},
    {"id": "testmap-0001", "type": "chest_normal", "x": "200", "y": "200", "entry": "Chest Set B",
     "entry_index": "2"},
    {"id": "testmap-0003", "type": "chest_normal", "x": "300", "y": "300", "entry": "chests-a", "tags": "hidden"},
    {"id": "testmap-0004", "type": "crystal", "x": "250.5", "y": "300.0", "entry": "crystals"},
    {"id": "testmap-0005", "type": "encounter", "x": "400", "y": "400", "entry": "quest"},
    {"id": "testmap-0005", "type": "encounter", "x": "410", "y": "420"},
    {"id": "testmap-0006", "type": "teleport", "x": "500", "y": "500", "entry": "teleports"},
    {"id": "testmap-0007", "type": "divine_trial", "x": "600", "y": "600", "subtype": "combat"},
    {"id": "testmap-0008", "type": "divine_trial", "x": "650", "y": "650", "subtype": "puzzle"},
    {"id": "testmap-0009", "type": "portal", "x": "700", "y": "700", "to": "othermap"},
    {"id": "testmap-0010", "type": "seed", "x": "800", "y": "800", "entry": "seeds", "seed": "1"},
    {"id": "testmap-0011", "type": "mechanism", "x": "810", "y": "810", "requires_seed": "1"},
]
TEXTS = [
    {"marker": "testmap-0006", "field": "name", "en": "North Gate", "pt": "Portão Norte"},
    {"marker": "testmap-0007", "field": "name", "en": "Trial of Strength"},
    {"marker": "testmap-0008", "field": "name", "en": "Trial of Wit"},
    {"marker": "testmap-0003", "field": "note", "en": "On the roof.", "zh": "在屋顶上。"},
    {"marker": "testmap-0005", "field": "howto", "en": "Talk to the guard twice."},
]
STAGES = [
    {"trial": "testmap-0007", "stage": "3", "stars": "3", "level": "14", "cp": "3000"},
    {"trial": "testmap-0007", "stage": "1", "stars": "1", "level": "10", "cp": "1000"},
    {"trial": "testmap-0007", "stage": "2", "stars": "2", "level": "12", "cp": "2000"},
    {"trial": "testmap-0008", "stage": "1", "stars": "1"},
    {"trial": "testmap-0008", "stage": "2", "stars": "1"},
    {"trial": "testmap-0008", "stage": "3", "stars": "2"},
]
FIXTURE = {"maps": MAPS, "entries": ENTRIES, "markers": MARKERS, "texts": TEXTS, "stages": STAGES}
CSV_FILES = {"entries": "entries.csv", "markers": "markers.csv", "texts": "marker_texts.csv",
             "stages": "stages.csv"}


def csv_text(rows):
    header = []
    for row in rows:
        header += [k for k in row if k not in header]
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=header, lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    return buf.getvalue()


def marker(f, mid):
    return next(r for r in f["markers"] if r["id"] == mid)


def entry(f, eid):
    return next(r for r in f["entries"] if r["id"] == eid)


def stage(f, trial, n):
    return next(r for r in f["stages"] if r["trial"] == trial and r["stage"] == str(n))


def text(f, mid, field):
    return next(r for r in f["texts"] if r["marker"] == mid and r["field"] == field)


class Result:
    def __init__(self, proc):
        self.code = proc.returncode
        self.output = proc.stdout + proc.stderr
        lines = proc.stdout.splitlines()
        self.errors = [l[len("ERROR   "):] for l in lines if l.startswith("ERROR   ")]
        self.warnings = [l[len("WARNING "):] for l in lines if l.startswith("WARNING ")]


class Project:
    """A made-up project in a temporary directory, built from a copy of FIXTURE."""

    def __init__(self, test):
        tmp = tempfile.TemporaryDirectory()
        test.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.data = copy.deepcopy(FIXTURE)

    def write(self):
        (self.root / "data").mkdir(exist_ok=True)
        (self.root / "data" / "maps.json").write_text(json.dumps(self.data["maps"]), encoding="utf-8")
        src = self.root / "data" / "src" / MAP
        src.mkdir(parents=True, exist_ok=True)
        for key, name in CSV_FILES.items():
            path = src / name
            if self.data[key] is None:
                path.unlink(missing_ok=True)
            else:
                path.write_text(csv_text(self.data[key]), encoding="utf-8", newline="")

    def build(self, *args):
        self.write()
        env = {**os.environ, "PYTHONIOENCODING": "utf-8"}
        proc = subprocess.run([sys.executable, str(BUILD), MAP, "--root", str(self.root), *args],
                              capture_output=True, text=True, encoding="utf-8", env=env)
        return Result(proc)

    def outputs(self):
        """{relative path: bytes} of every generated file."""
        files = [*(self.root / "data" / "markers").glob("*.json"), *(self.root / "data" / "entries").glob("*.json"),
                 *(self.root / "i18n").glob("*.json")]
        return {p.relative_to(self.root).as_posix(): p.read_bytes() for p in files}

    def json(self, path):
        return json.loads((self.root / path).read_text(encoding="utf-8"))


def remove(rows, row):
    rows.remove(row)


# (description, change to the fixture, expected text in one of the error lines)
ERROR_CASES = [
    # markers.csv
    ("malformed id", lambda f: marker(f, "testmap-0003").update(id="testmap-12"), "must look like 'testmap-0001'"),
    ("id of another map", lambda f: marker(f, "testmap-0003").update(id="othermap-0003"), "must look like"),
    ("unknown type", lambda f: marker(f, "testmap-0003").update(type="chest_gold"), "unknown type 'chest_gold'"),
    ("outside the image", lambda f: marker(f, "testmap-0003").update(x="2000"), "falls outside the map image"),
    ("comma as decimal separator", lambda f: marker(f, "testmap-0003").update(x="300,5"),
     "use a dot as the decimal separator"),
    ("coordinate not a number", lambda f: marker(f, "testmap-0003").update(y="abc"), "'abc' is not a number"),
    ("coordinate not finite", lambda f: marker(f, "testmap-0003").update(y="inf"), "is not a finite number"),
    ("repeated id on a non-encounter", lambda f: f["markers"].append(dict(marker(f, "testmap-0003"))),
     "duplicate id 'testmap-0003'"),
    ("missing required column", lambda f: [r.pop("y") for r in f["markers"]], "missing required column(s): y"),
    ("unknown entry", lambda f: marker(f, "testmap-0003").update(entry="nope"), "unknown entry 'nope'"),
    ("entry of another type", lambda f: marker(f, "testmap-0004").update(entry="chests-a"),
     "entry 'chests-a' has type 'chest_normal', not 'crystal'"),
    ("entry missing", lambda f: marker(f, "testmap-0003").update(entry=""), "type 'chest_normal' requires an entry"),
    ("entry on a type without entries", lambda f: marker(f, "testmap-0009").update(entry="chests-a"),
     "type 'portal' does not belong to an exploration entry"),
    ("more markers than the entry size",
     lambda f: f["markers"].append({"id": "testmap-0012", "type": "chest_normal", "x": "1", "y": "1",
                                    "entry": "chests-a"}),
     "chests-a: has 2 markers but the game says 1"),
    ("entry_index above the size", lambda f: marker(f, "testmap-0003").update(entry_index="2"),
     "entry_index 2 is above the size of 'chests-a'"),
    ("entry_index repeated", lambda f: marker(f, "testmap-0001").update(entry_index="1"),
     "entry_index 1 is already used by testmap-0002"),
    ("entry_index without an entry", lambda f: marker(f, "testmap-0009").update(entry_index="1"),
     "entry_index needs an entry"),
    ("extra column on another type", lambda f: marker(f, "testmap-0003").update(players="2"),
     "column 'players' is only valid for type chest_challenge, chest_coop"),
    ("required extra column missing", lambda f: marker(f, "testmap-0009").update(to=""),
     "type 'portal' requires column 'to'"),
    ("value outside an enum", lambda f: marker(f, "testmap-0008").update(subtype="riddle"),
     "subtype 'riddle' must be one of: combat, puzzle"),
    ("seed not an integer", lambda f: marker(f, "testmap-0010").update(seed="1.5"), "'1.5' must be an integer"),
    ("species not a slug",
     lambda f: f["markers"].append({"id": "testmap-0012", "type": "boss", "x": "1", "y": "1",
                                    "species": "Supreme Bear"}),
     "species 'Supreme Bear' must be a lowercase slug"),
    ("link to an unknown marker", lambda f: marker(f, "testmap-0002").update(links="testmap-0999"),
     "links to unknown marker 'testmap-0999'"),
    ("seed number used twice",
     lambda f: (entry(f, "seeds").update(size="2"),
                f["markers"].append({"id": "testmap-0012", "type": "seed", "x": "1", "y": "1", "entry": "seeds",
                                     "seed": "1"})),
     "seed number 1 is used by 2 markers"),
    ("malformed tag", lambda f: marker(f, "testmap-0003").update(tags="Hidden"),
     "tag 'Hidden' must use lowercase letters"),
    ("repeated tag", lambda f: marker(f, "testmap-0003").update(tags="hidden;hidden"), "repeated tag"),
    ("hidden and purple_demon_eye on a marker", lambda f: marker(f, "testmap-0003").update(tags="hidden;purple_demon_eye"),
     "tags 'hidden' and 'purple_demon_eye' never go together"),
    ("hidden on an entry, purple_demon_eye on its marker", lambda f: (entry(f, "chests-a").update(tags="hidden"),
                                                                     marker(f, "testmap-0003").update(tags="purple_demon_eye")),
     "tags 'hidden' and 'purple_demon_eye' never go together"),
    # entries.csv
    ("entry id not a slug", lambda f: entry(f, "crystals").update(id="Crystals_1"),
     "id 'Crystals_1' must be a lowercase slug"),
    ("repeated entry id", lambda f: f["entries"].append(dict(entry(f, "crystals"), name_en="Other")),
     "duplicate entry id 'crystals'"),
    ("hidden and purple_demon_eye on an entry", lambda f: entry(f, "chests-b").update(tags="hidden;purple_demon_eye"),
     "tags 'hidden' and 'purple_demon_eye' never go together"),
    ("entry of a type without entries", lambda f: entry(f, "crystals").update(type="divine_trial"),
     "type 'divine_trial' is not a marker type that belongs to an entry"),
    ("entry without name_en", lambda f: entry(f, "crystals").update(name_en=""), "name_en is required"),
    ("entry size zero", lambda f: entry(f, "crystals").update(size="0"), "size: 0 is out of range"),
    ("repeated name_en, any case", lambda f: entry(f, "crystals").update(name_en="chest set a"),
     "name_en 'chest set a' is already used by 'chests-a'"),
    # stages.csv
    ("unknown trial", lambda f: stage(f, "testmap-0008", 1).update(trial="testmap-0001"),
     "'testmap-0001' is not a divine_trial marker"),
    ("stage gap", lambda f: remove(f["stages"], stage(f, "testmap-0008", 2)), "testmap-0008: missing stage(s) [2]"),
    ("fewer than 3 stages", lambda f: remove(f["stages"], stage(f, "testmap-0008", 3)),
     "testmap-0008: has 2 stages; trials have 3 to 10"),
    ("more than 10 stages", lambda f: stage(f, "testmap-0008", 3).update(stage="11"), "stage: 11 is out of range"),
    ("repeated stage", lambda f: stage(f, "testmap-0008", 3).update(stage="1"),
     "stage 1 of 'testmap-0008' is already listed"),
    ("stars out of range", lambda f: stage(f, "testmap-0008", 1).update(stars="6"), "stars: 6 is out of range"),
    ("combat stage without level", lambda f: stage(f, "testmap-0007", 1).update(level=""),
     "combat trial stages require level"),
    ("level on a puzzle stage", lambda f: stage(f, "testmap-0008", 1).update(level="10"),
     "level and cp are only for combat trials"),
    ("cp on a puzzle stage", lambda f: stage(f, "testmap-0008", 1).update(cp="100"),
     "level and cp are only for combat trials"),
    # marker_texts.csv
    ("text of an unknown marker", lambda f: text(f, "testmap-0003", "note").update(marker="testmap-0999"),
     "unknown marker 'testmap-0999'"),
    ("unknown text field", lambda f: text(f, "testmap-0003", "note").update(field="title"),
     "field 'title' must be one of: name, note, howto"),
    ("name on a type without names", lambda f: text(f, "testmap-0003", "note").update(field="name"),
     "field 'name' is only valid for type"),
    ("repeated text field", lambda f: f["texts"].append(dict(text(f, "testmap-0003", "note"))),
     "'testmap-0003' already has a 'note'"),
    ("text without English", lambda f: text(f, "testmap-0003", "note").update(en=""),
     "en is required (English is the fallback)"),
]

# (description, change to the fixture, expected text in one of the warning lines)
WARNING_CASES = [
    ("incomplete entry", lambda f: entry(f, "chests-b").update(size="3"), "chests-b: has 2 of 3 markers"),
    ("entry_index gap", lambda f: (entry(f, "chests-b").update(size="3"), marker(f, "testmap-0001").update(entry_index="3")),
     "chests-b: entry_index gaps: [2]"),
    ("mechanism without its seed", lambda f: marker(f, "testmap-0011").update(requires_seed="2"),
     "requires seed 2 but no seed marker has that number"),
    ("seed without its mechanism", lambda f: marker(f, "testmap-0011").update(requires_seed="2"),
     "seed 1 has no mechanism yet"),
    ("portal to a map not added yet", lambda f: marker(f, "testmap-0009").update(to="suotuo"),
     "portal destination 'suotuo' is not in maps.json yet"),
    ("teleport without a name", lambda f: remove(f["texts"], text(f, "testmap-0006", "name")),
     "teleport has no name in marker_texts.csv"),
    ("trial without stages", lambda f: [remove(f["stages"], stage(f, "testmap-0008", n)) for n in (1, 2, 3)],
     "testmap-0008: divine trial has no stages"),
    ("no stages file at all", lambda f: f.update(stages=None), "testmap-0007: divine trial has no stages"),
    ("combat stage without cp", lambda f: stage(f, "testmap-0007", 2).update(cp=""),
     "no recommended CP yet for stage(s) [2]"),
    ("stage levels go down", lambda f: stage(f, "testmap-0007", 3).update(level="11"),
     "stage levels go down: [10, 12, 11]"),
    ("marker tag already on its entry", lambda f: marker(f, "testmap-0003").update(tags="hidden;grappling_hook"),
     "tag 'grappling_hook' is already on entry 'chests-a'"),
    ("unknown column", lambda f: marker(f, "testmap-0003").update(colour="red"), "unknown column 'colour' ignored"),
    ("incomplete calibration", lambda f: f["maps"][MAP]["calibration"].update(offsetX=None),
     "calibration is incomplete"),
]


class ValidBuild(unittest.TestCase):
    def setUp(self):
        self.project = Project(self)
        self.result = self.project.build()
        self.assertEqual(self.result.code, 0, self.result.output)

    def test_base_fixture_has_no_errors_or_warnings(self):
        self.assertEqual(self.result.errors, [])
        self.assertEqual(self.result.warnings, [])

    def test_writes_every_output(self):
        expected = {f"data/markers/{MAP}.json", f"data/entries/{MAP}.json",
                    *(f"i18n/{kind}.{MAP}.{lang}.json" for kind in ("entries", "markers") for lang in ("en", "pt", "zh"))}
        self.assertEqual(set(self.project.outputs()), expected)

    def test_markers(self):
        markers = self.project.json(f"data/markers/{MAP}.json")
        by_id = {m["id"]: m for m in markers}
        self.assertEqual([m["id"] for m in markers], sorted(by_id), "sorted by id")
        # An entry may be referenced by its English name.
        self.assertEqual(by_id["testmap-0001"]["entry"], "chests-b")
        self.assertEqual(by_id["testmap-0001"]["entryIndex"], 2)
        self.assertEqual(by_id["testmap-0002"]["links"], ["testmap-0001"])
        # Whole numbers become ints, others stay floats.
        self.assertEqual((by_id["testmap-0004"]["x"], by_id["testmap-0004"]["y"]), (250.5, 300))
        self.assertIsInstance(by_id["testmap-0004"]["y"], int)
        # Own tags only; the entry's tags stay on the entry.
        self.assertEqual(by_id["testmap-0003"]["tags"], ["hidden"])
        # An encounter repeated on several rows is one marker with all its points, the first row first.
        self.assertEqual(sum(m["id"] == "testmap-0005" for m in markers), 1)
        self.assertEqual(by_id["testmap-0005"]["points"], [{"x": 400, "y": 400}, {"x": 410, "y": 420}])
        self.assertEqual(by_id["testmap-0009"]["to"], "othermap")
        self.assertEqual(by_id["testmap-0010"]["seed"], 1)
        self.assertEqual(by_id["testmap-0011"]["requiresSeed"], 1)

    def test_trial_stages_in_play_order(self):
        by_id = {m["id"]: m for m in self.project.json(f"data/markers/{MAP}.json")}
        self.assertEqual(by_id["testmap-0007"]["subtype"], "combat")
        self.assertEqual(by_id["testmap-0007"]["stages"], [
            {"stars": 1, "level": 10, "cp": 1000},
            {"stars": 2, "level": 12, "cp": 2000},
            {"stars": 3, "level": 14, "cp": 3000},
        ])
        self.assertEqual(by_id["testmap-0008"]["stages"], [{"stars": 1}, {"stars": 1}, {"stars": 2}])

    def test_entries_keep_the_csv_order(self):
        entries = self.project.json(f"data/entries/{MAP}.json")
        self.assertEqual(list(entries), [e["id"] for e in ENTRIES])
        self.assertEqual(entries["chests-a"], {"type": "chest_normal", "size": 1, "tags": ["grappling_hook"]})

    def test_entry_texts_per_language(self):
        en = self.project.json(f"i18n/entries.{MAP}.en.json")
        pt = self.project.json(f"i18n/entries.{MAP}.pt.json")
        self.assertEqual(en["chests-b"], {"name": "Chest Set B", "description": "Two chests."})
        self.assertEqual(len(en), len(ENTRIES))
        # Languages without a text leave the entry out, so the site falls back to English.
        self.assertEqual(pt, {"chests-b": {"name": "Baús B"}})

    def test_marker_texts_per_language(self):
        en = self.project.json(f"i18n/markers.{MAP}.en.json")
        zh = self.project.json(f"i18n/markers.{MAP}.zh.json")
        self.assertEqual(en["testmap-0003"], {"note": "On the roof."})
        self.assertEqual(en["testmap-0005"], {"howto": "Talk to the guard twice."})
        self.assertEqual(zh, {"testmap-0003": {"note": "在屋顶上。"}})

    def test_rebuild_gives_the_same_bytes(self):
        # CI rebuilds the data and fails on any difference, so the output must be deterministic.
        first = self.project.outputs()
        self.assertEqual(self.project.build().code, 0)
        self.assertEqual(self.project.outputs(), first)

    def test_outputs_use_lf_and_utf8(self):
        for path, content in self.project.outputs().items():
            self.assertNotIn(b"\r", content, path)
            content.decode("utf-8")
        self.assertIn("Baús B".encode("utf-8"), self.project.outputs()[f"i18n/entries.{MAP}.pt.json"])


class Options(unittest.TestCase):
    def test_check_writes_nothing(self):
        project = Project(self)
        result = project.build("--check")
        self.assertEqual(result.code, 0, result.output)
        self.assertIn("nothing written (--check)", result.output)
        self.assertEqual(project.outputs(), {})

    def test_strict_fails_on_warnings(self):
        project = Project(self)
        entry(project.data, "chests-b").update(size="3")
        self.assertEqual(project.build().code, 0)
        result = project.build("--strict")
        self.assertNotEqual(result.code, 0)
        self.assertIn("Build failed: 0 error(s), 1 warning(s)", result.output)

    def test_unknown_map(self):
        project = Project(self)
        project.write()
        proc = subprocess.run([sys.executable, str(BUILD), "nowhere", "--root", str(project.root)],
                              capture_output=True, text=True)
        self.assertNotEqual(proc.returncode, 0)
        self.assertIn("Unknown map 'nowhere'", proc.stderr)

    def test_missing_markers_file(self):
        project = Project(self)
        project.data["markers"] = None
        result = project.build()
        self.assertNotEqual(result.code, 0)
        self.assertIn("Missing", result.output)

    def test_optional_columns_may_be_left_out(self):
        project = Project(self)
        for row in project.data["texts"]:
            row.pop("pt", None)
            row.pop("zh", None)
        for row in project.data["entries"]:
            for col in ("tags", "name_pt", "name_zh", "desc_en"):
                row.pop(col, None)
        result = project.build()
        self.assertEqual(result.code, 0, result.output)
        self.assertEqual(result.warnings, [])


class Errors(unittest.TestCase):
    def test_cases(self):
        for description, change, message in ERROR_CASES:
            with self.subTest(description):
                project = Project(self)
                change(project.data)
                result = project.build()
                self.assertNotEqual(result.code, 0, result.output)
                self.assertTrue(any(message in e for e in result.errors),
                                f"expected an error with {message!r}, got:\n{result.output}")
                self.assertEqual(project.outputs(), {}, "nothing is written when there are errors")

    def test_errors_keep_the_previous_build(self):
        project = Project(self)
        project.build()
        before = project.outputs()
        marker(project.data, "testmap-0003").update(type="chest_gold")
        self.assertNotEqual(project.build().code, 0)
        self.assertEqual(project.outputs(), before)

    def test_id_changed_type_since_the_last_build(self):
        project = Project(self)
        self.assertEqual(project.build().code, 0)
        marker(project.data, "testmap-0009").update(type="book", to="")
        project.data["texts"].append({"marker": "testmap-0009", "field": "name", "en": "A Book"})
        result = project.build()
        self.assertNotEqual(result.code, 0)
        self.assertIn("testmap-0009: changed type from 'portal' to 'book' (ids must never be reused)", result.errors)


class Warnings(unittest.TestCase):
    def test_cases(self):
        for description, change, message in WARNING_CASES:
            with self.subTest(description):
                project = Project(self)
                change(project.data)
                result = project.build()
                self.assertEqual(result.code, 0, result.output)
                self.assertTrue(any(message in w for w in result.warnings),
                                f"expected a warning with {message!r}, got:\n{result.output}")
                self.assertNotEqual(project.outputs(), {}, "warnings do not stop the build")

    def test_marker_tag_already_on_its_entry_is_dropped(self):
        project = Project(self)
        marker(project.data, "testmap-0003").update(tags="hidden;grappling_hook")
        project.build()
        by_id = {m["id"]: m for m in project.json(f"data/markers/{MAP}.json")}
        self.assertEqual(by_id["testmap-0003"]["tags"], ["hidden"])

    def test_id_gone_since_the_last_build(self):
        project = Project(self)
        self.assertEqual(project.build().code, 0)
        remove(project.data["markers"], marker(project.data, "testmap-0004"))
        result = project.build()
        self.assertEqual(result.code, 0, result.output)
        self.assertIn("testmap-0004: was in the previous build but is gone (ids must never be reused)",
                      result.warnings)


if __name__ == "__main__":
    unittest.main()
