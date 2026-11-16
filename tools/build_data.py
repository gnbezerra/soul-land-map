#!/usr/bin/env python3
"""Build the site's JSON data from the collection spreadsheet exported as CSV.

Usage:
    python tools/build_data.py nuoding            # validate and write the JSON files
    python tools/build_data.py nuoding --check    # validate only, write nothing
    python tools/build_data.py nuoding --strict   # warnings also fail the build

Inputs (one sheet tab per map, exported as UTF-8 CSV with a header row):
    data/src/<map>/markers.csv   one row per marker
    data/src/<map>/entries.csv   one row per exploration entry (the in-game list)
    data/src/<map>/marker_texts.csv  one row per marker text (name, note, howto), optional
    data/src/<map>/stages.csv    one row per Divine Trial stage, optional
    data/maps.json               image size and calibration (used for bounds checks)

Only the required columns listed below must be present; any other column may be left
out of the sheet when no row uses it.

Outputs (nothing is written if there are errors):
    data/markers/<map>.json
    data/entries/<map>.json
    i18n/entries.<map>.<lang>.json   official entry names and descriptions
    i18n/markers.<map>.<lang>.json   marker texts (Divine Trial names, notes, howtos)

markers.csv columns
    id, type, x, y                         always required
    entry                                  entry id, or its English name (types that belong to an entry)
    entry_index                            number of the [Location N] link in the game's answer
    subtype      (divine_trial)            puzzle | combat
    players      (chest_coop)              1 to 4
                 (chest_challenge)         optional, 1 to 4; empty means a single player
    contract     (chest_contract)          wood | flame | frost
    pillar_x, pillar_y (chest_challenge)   optional, both or neither
    seed         (seed)                    number shown by the game when picking it up
    requires_seed (mechanism)              seed number needed to activate it
    species      (boss)                    e.g. supreme-bear
    to           (portal)                  id of the destination map
    links                                  related marker ids separated by ';'
    tags                                   this marker's own requirements, separated by ';'
                                           (on top of its entry's tags)

An encounter with several points repeats its id on several rows; the first row
is the primary point and all rows end up in "points". No other type may repeat an id.

entries.csv columns
    id, type, name_en, size                required (type is the marker type of its members)
    tags                                   separated by ';' ('unlisted': an entry of the site's own, for
                                           objects the game counts but lists in no entry)
    name_pt, name_zh, desc_en, desc_pt, desc_zh   optional official texts

marker_texts.csv columns (one row per marker and field)
    marker, field, en                      required
                                           field: name (divine_trial, book, teleport, viewpoint), note (always shown),
                                           howto (solution, shown on request)
    pt, zh                                 optional

stages.csv columns
    trial, stage, stars                    required (stage: 1, 2, 3... in play order, no gaps;
                                           stars: 1 to 5)
    level                                  combat trials only (required): level needed to enter
    cp                                     combat trials only (optional until collected): recommended CP
"""
import argparse
import csv
import json
import math
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

MARKER_TYPES = {
    "chest_normal", "chest_coop", "chest_challenge", "chest_contract", "chest_boss", "crystal",
    "divine_trial", "encounter", "teleport", "viewpoint", "seed", "mechanism",
    "portal", "book", "boss", "arena",
}
# Types whose markers belong to an exploration entry (the in-game list).
ENTRY_TYPES = {
    "chest_normal", "chest_coop", "chest_challenge", "chest_contract", "chest_boss", "crystal",
    "encounter", "teleport", "viewpoint", "seed",
}
# Extra column -> the only marker types where it may be filled in.
EXTRA_COLUMNS = {
    "subtype": {"divine_trial"},
    "players": {"chest_coop", "chest_challenge"},
    "contract": {"chest_contract"},
    "pillar_x": {"chest_challenge"},
    "pillar_y": {"chest_challenge"},
    "seed": {"seed"},
    "requires_seed": {"mechanism"},
    "species": {"boss"},
    "to": {"portal"},
}
REQUIRED_EXTRAS = {
    "divine_trial": ["subtype"],
    "chest_coop": ["players"],
    "chest_contract": ["contract"],
    "seed": ["seed"],
    "mechanism": ["requires_seed"],
    "boss": ["species"],
    "portal": ["to"],
}
ENUMS = {"subtype": {"puzzle", "combat"}, "contract": {"wood", "flame", "frost"}}
MARKER_COLUMNS = {"id", "type", "x", "y", "entry", "entry_index", "links", "tags", *EXTRA_COLUMNS}
ENTRY_COLUMNS = {"id", "type", "name_en", "size", "tags",
                 "name_pt", "name_zh", "desc_en", "desc_pt", "desc_zh"}
LANGS = ("en", "pt", "zh")
TEXT_COLUMNS = {"marker", "field", *LANGS}
# Text field -> the only marker types where it may be used (None: any type).
TEXT_FIELDS = {"name": {"divine_trial", "book", "teleport", "viewpoint"}, "note": None, "howto": None}
STAGE_COLUMNS = {"trial", "stage", "stars", "level", "cp"}
MIN_STAGES, MAX_STAGES = 3, 10
SLUG = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
TAG = re.compile(r"^[a-z0-9_]+$")


class Report:
    def __init__(self):
        self.errors = []
        self.warnings = []

    def error(self, where, msg):
        self.errors.append(f"{where}: {msg}")

    def warn(self, where, msg):
        self.warnings.append(f"{where}: {msg}")


def read_csv(path, allowed, required, rep):
    """Return [(line_number, {column: stripped value})] or None if the file is missing."""
    if not path.exists():
        return None
    rows = []
    with open(path, encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        header = [h.strip().lower() for h in (reader.fieldnames or [])]
        reader.fieldnames = header
        for h in header:
            if h not in allowed:
                rep.warn(path.name, f"unknown column '{h}' ignored")
        missing = [c for c in required if c not in header]
        if missing:
            rep.error(path.name, f"missing required column(s): {', '.join(missing)}")
            return []
        for row in reader:
            # Optional columns left out of the sheet read as empty.
            clean = dict.fromkeys(allowed, "")
            clean.update({k: (v or "").strip() for k, v in row.items() if k in allowed})
            if any(clean.values()):
                rows.append((reader.line_num, clean))
    return rows


def parse_number(value, where, name, rep):
    if "," in value:
        rep.error(where, f"{name}: use a dot as the decimal separator, got '{value}'")
        return None
    try:
        n = float(value)
    except ValueError:
        rep.error(where, f"{name}: '{value}' is not a number")
        return None
    if not math.isfinite(n):
        rep.error(where, f"{name}: '{value}' is not a finite number")
        return None
    return int(n) if n == int(n) else n


def parse_int(value, where, name, rep, lo=None, hi=None):
    n = parse_number(value, where, name, rep)
    if n is None:
        return None
    if not isinstance(n, int):
        rep.error(where, f"{name}: '{value}' must be an integer")
        return None
    if (lo is not None and n < lo) or (hi is not None and n > hi):
        rep.error(where, f"{name}: {n} is out of range")
        return None
    return n


def parse_tags(value, where, rep):
    tags = [t.strip() for t in value.split(";") if t.strip()]
    for t in tags:
        if not TAG.match(t):
            rep.error(where, f"tag '{t}' must use lowercase letters, digits and underscores")
    if len(set(tags)) < len(tags):
        rep.error(where, f"repeated tag in '{value}'")
    return tags


def load_entries(rows, rep):
    entries, texts, by_name = {}, {}, {}
    for line, r in rows:
        where = f"entries.csv:{line}"
        eid = r["id"]
        if not SLUG.match(eid):
            rep.error(where, f"id '{eid}' must be a lowercase slug like 'nuoding-academy-1'")
            continue
        if eid in entries:
            rep.error(where, f"duplicate entry id '{eid}'")
            continue
        if r["type"] not in ENTRY_TYPES:
            rep.error(where, f"type '{r['type']}' is not a marker type that belongs to an entry")
            continue
        if not r["name_en"]:
            rep.error(where, "name_en is required")
            continue
        size = parse_int(r["size"], where, "size", rep, lo=1)
        if size is None:
            continue
        tags = parse_tags(r["tags"], where, rep)
        entry = {"type": r["type"], "size": size}
        if tags:
            entry["tags"] = tags
        entries[eid] = entry
        texts[eid] = {lang: {"name": r.get(f"name_{lang}", ""), "description": r.get(f"desc_{lang}", "")}
                      for lang in LANGS}
        key = r["name_en"].casefold()
        if key in by_name:
            rep.error(where, f"name_en '{r['name_en']}' is already used by '{by_name[key]}'")
        by_name[key] = eid
    return entries, texts, by_name


def make_bounds_check(map_cfg, rep):
    cal = map_cfg.get("calibration") or {}
    if not all(isinstance(cal.get(k), (int, float)) for k in ("scaleX", "offsetX", "scaleY", "offsetY")):
        rep.warn("maps.json", "calibration is incomplete: coordinate bounds check skipped")
        return lambda x, y: True
    w, h = map_cfg["image"]["width"], map_cfg["image"]["height"]

    def inside(x, y):
        px = cal["scaleX"] * x + cal["offsetX"]
        py = cal["scaleY"] * y + cal["offsetY"]
        return 0 <= px <= w and 0 <= py <= h
    return inside


def load_markers(rows, map_id, entries, by_name, inside, rep):
    markers = {}
    seen_index = {}
    id_pattern = re.compile(rf"^{re.escape(map_id)}-\d{{4,}}$")
    for line, r in rows:
        where = f"markers.csv:{line}"
        mid, mtype = r["id"], r["type"]
        if not id_pattern.match(mid):
            rep.error(where, f"id '{mid}' must look like '{map_id}-0001'")
            continue
        if mtype not in MARKER_TYPES:
            rep.error(where, f"unknown type '{mtype}'")
            continue
        x = parse_number(r["x"], where, "x", rep)
        y = parse_number(r["y"], where, "y", rep)
        if x is None or y is None:
            continue
        if not inside(x, y):
            rep.error(where, f"({x}, {y}) falls outside the map image")

        # Repeated ids are only allowed for encounters with several points.
        if mid in markers:
            prev = markers[mid]
            if mtype != "encounter" or prev["type"] != "encounter":
                rep.error(where, f"duplicate id '{mid}' (only encounters may repeat an id)")
            else:
                prev.setdefault("points", [{"x": prev["x"], "y": prev["y"]}]).append({"x": x, "y": y})
            continue

        # Extra columns: filled only for their own types, required for some types.
        for col, types in EXTRA_COLUMNS.items():
            if r.get(col) and mtype not in types:
                rep.error(where, f"column '{col}' is only valid for type {', '.join(sorted(types))}")
        for col in REQUIRED_EXTRAS.get(mtype, []):
            if not r.get(col):
                rep.error(where, f"type '{mtype}' requires column '{col}'")
        for col, allowed in ENUMS.items():
            if r.get(col) and r[col] not in allowed:
                rep.error(where, f"{col} '{r[col]}' must be one of: {', '.join(sorted(allowed))}")

        m = {"id": mid, "type": mtype}
        if r.get("subtype"):
            m["subtype"] = r["subtype"]

        # Entry membership.
        ref = r["entry"]
        entry_bad = False
        if mtype in ENTRY_TYPES:
            if not ref:
                rep.error(where, f"type '{mtype}' requires an entry")
            else:
                slug = ref if ref in entries else by_name.get(ref.casefold())
                if slug is None:
                    rep.error(where, f"unknown entry '{ref}'")
                    entry_bad = True
                elif entries[slug]["type"] != mtype:
                    rep.error(where, f"entry '{slug}' has type '{entries[slug]['type']}', not '{mtype}'")
                    entry_bad = True
                else:
                    m["entry"] = slug
        elif ref:
            rep.error(where, f"type '{mtype}' does not belong to an exploration entry")

        if r["entry_index"]:
            idx = parse_int(r["entry_index"], where, "entry_index", rep, lo=1)
            if idx is not None:
                if "entry" not in m:
                    if not entry_bad and not ref:
                        rep.error(where, "entry_index needs an entry")
                else:
                    if idx > entries[m["entry"]]["size"]:
                        rep.error(where, f"entry_index {idx} is above the size of '{m['entry']}'")
                    if (m["entry"], idx) in seen_index:
                        rep.error(where, f"entry_index {idx} is already used by {seen_index[(m['entry'], idx)]}")
                    seen_index[(m["entry"], idx)] = mid
                    m["entryIndex"] = idx

        m["x"], m["y"] = x, y
        if r["players"]:
            v = parse_int(r["players"], where, "players", rep, lo=1, hi=4)
            if v is not None:
                m["players"] = v
        if r["contract"]:
            m["contract"] = r["contract"]
        if r["seed"]:
            v = parse_int(r["seed"], where, "seed", rep, lo=1)
            if v is not None:
                m["seed"] = v
        if r["requires_seed"]:
            v = parse_int(r["requires_seed"], where, "requires_seed", rep, lo=1)
            if v is not None:
                m["requiresSeed"] = v
        if r["species"]:
            if SLUG.match(r["species"]):
                m["species"] = r["species"]
            else:
                rep.error(where, f"species '{r['species']}' must be a lowercase slug like 'supreme-bear'")
        if r["to"]:
            m["to"] = r["to"]
        if r["pillar_x"] or r["pillar_y"]:
            px = parse_number(r["pillar_x"], where, "pillar_x", rep) if r["pillar_x"] else None
            py = parse_number(r["pillar_y"], where, "pillar_y", rep) if r["pillar_y"] else None
            if px is None or py is None:
                rep.error(where, "pillar_x and pillar_y must be filled in together")
            else:
                m["pillar"] = {"x": px, "y": py}
        if r["links"]:
            m["links"] = [s.strip() for s in r["links"].split(";") if s.strip()]
        if r["tags"]:
            tags = parse_tags(r["tags"], where, rep)
            inherited = set(entries[m["entry"]].get("tags", [])) if "entry" in m else set()
            for t in tags:
                if t in inherited:
                    rep.warn(where, f"tag '{t}' is already on entry '{m['entry']}'")
            own = [t for t in tags if t not in inherited]
            if own:
                m["tags"] = own
        markers[mid] = m
    return markers


def load_texts(rows, markers, rep):
    """Return {marker id: {field: {lang: text}}} from marker_texts.csv."""
    texts = defaultdict(dict)
    for line, r in rows:
        where = f"marker_texts.csv:{line}"
        mid, field = r["marker"], r["field"]
        if mid not in markers:
            rep.error(where, f"unknown marker '{mid}'")
            continue
        if field not in TEXT_FIELDS:
            rep.error(where, f"field '{field}' must be one of: {', '.join(TEXT_FIELDS)}")
            continue
        types = TEXT_FIELDS[field]
        if types and markers[mid]["type"] not in types:
            rep.error(where, f"field '{field}' is only valid for type {', '.join(sorted(types))}")
            continue
        if field in texts[mid]:
            rep.error(where, f"'{mid}' already has a '{field}'")
            continue
        if not r["en"]:
            rep.error(where, "en is required (English is the fallback)")
            continue
        texts[mid][field] = {lang: r[lang] for lang in LANGS}
    # Types that have no entry take their title from their own name.
    for mid, m in markers.items():
        if m["type"] in TEXT_FIELDS["name"] and "name" not in texts.get(mid, {}):
            rep.warn(mid, f"{m['type']} has no name in marker_texts.csv")
    return texts


def load_trials(stage_rows, markers, rep):
    """Attach "stages" to divine_trial markers."""
    trials = {mid: m for mid, m in markers.items() if m["type"] == "divine_trial"}
    stages = defaultdict(dict)
    for line, r in stage_rows:
        where = f"stages.csv:{line}"
        tid = r["trial"]
        if tid not in trials:
            rep.error(where, f"'{tid}' is not a divine_trial marker in markers.csv")
            continue
        n = parse_int(r["stage"], where, "stage", rep, lo=1, hi=MAX_STAGES)
        stars = parse_int(r["stars"], where, "stars", rep, lo=1, hi=5)
        if n is None or stars is None:
            continue
        if n in stages[tid]:
            rep.error(where, f"stage {n} of '{tid}' is already listed")
            continue
        stage = {"stars": stars}
        if trials[tid].get("subtype") == "combat":
            if not r["level"]:
                rep.error(where, "combat trial stages require level")
                continue
            level = parse_int(r["level"], where, "level", rep, lo=1)
            if level is None:
                continue
            stage["level"] = level
            # The recommended CP may still be unknown; an empty cell leaves it out.
            if r["cp"]:
                cp = parse_int(r["cp"], where, "cp", rep, lo=0)
                if cp is None:
                    continue
                stage["cp"] = cp
        elif r["level"] or r["cp"]:
            rep.error(where, "level and cp are only for combat trials")
            continue
        stages[tid][n] = stage

    for tid, m in trials.items():
        got = stages.get(tid)
        if not got:
            rep.warn(tid, "divine trial has no stages in stages.csv")
            continue
        numbers = sorted(got)
        gaps = sorted(set(range(1, numbers[-1] + 1)) - set(numbers))
        if gaps:
            rep.error(tid, f"missing stage(s) {gaps}")
        elif len(numbers) < MIN_STAGES:
            rep.error(tid, f"has {len(numbers)} stages; trials have {MIN_STAGES} to {MAX_STAGES}")
        else:
            m["stages"] = [got[i] for i in numbers]
            if m.get("subtype") == "combat":
                no_cp = [i for i in numbers if "cp" not in got[i]]
                if no_cp:
                    rep.warn(tid, f"no recommended CP yet for stage(s) {no_cp}")
            levels = [s["level"] for s in m["stages"] if "level" in s]
            if any(b < a for a, b in zip(levels, levels[1:])):
                rep.warn(tid, f"stage levels go down: {levels}")


def cross_check(markers, entries, maps, rep):
    ids = set(markers)
    for m in markers.values():
        for target in m.get("links", []):
            if target not in ids:
                rep.error(m["id"], f"links to unknown marker '{target}'")
        # A portal without "to" was already reported by load_markers.
        if m["type"] == "portal" and "to" in m and m["to"] not in maps:
            rep.warn(m["id"], f"portal destination '{m['to']}' is not in maps.json yet")

    by_entry = defaultdict(list)
    for m in markers.values():
        if "entry" in m:
            by_entry[m["entry"]].append(m)
    for eid, e in entries.items():
        count = len(by_entry.get(eid, []))
        if count > e["size"]:
            rep.error(eid, f"has {count} markers but the game says {e['size']}")
        elif count < e["size"]:
            rep.warn(eid, f"has {count} of {e['size']} markers")
        indexes = sorted(m["entryIndex"] for m in by_entry.get(eid, []) if "entryIndex" in m)
        if indexes:
            gaps = sorted(set(range(1, indexes[-1] + 1)) - set(indexes))
            if gaps:
                rep.warn(eid, f"entry_index gaps: {gaps}")

    seeds = [m for m in markers.values() if m["type"] == "seed"]
    seed_numbers = Counter(m["seed"] for m in seeds if "seed" in m)
    for n, c in seed_numbers.items():
        if c > 1:
            rep.error("seed", f"seed number {n} is used by {c} markers")
    for m in markers.values():
        if m["type"] == "mechanism" and m.get("requiresSeed") not in seed_numbers:
            rep.warn(m["id"], f"requires seed {m.get('requiresSeed')} but no seed marker has that number")
    required = {m.get("requiresSeed") for m in markers.values() if m["type"] == "mechanism"}
    for n in seed_numbers:
        if n not in required:
            rep.warn("seed", f"seed {n} has no mechanism yet")


def compare_with_previous(path, markers, rep):
    """Ids are permanent: flag removed ids and ids that changed type since the last build."""
    if not path.exists():
        return
    try:
        previous = {m["id"]: m for m in json.loads(path.read_text(encoding="utf-8"))}
    except (ValueError, KeyError, TypeError):
        rep.warn(path.name, "previous build could not be read; id stability check skipped")
        return
    for pid, pm in previous.items():
        if pid not in markers:
            rep.warn(pid, "was in the previous build but is gone (ids must never be reused)")
        elif markers[pid]["type"] != pm["type"]:
            rep.error(pid, f"changed type from '{pm['type']}' to '{markers[pid]['type']}' (ids must never be reused)")


def dump_markers(markers):
    lines = [json.dumps(markers[i], ensure_ascii=False) for i in sorted(markers)]
    return "[\n" + ",\n".join("  " + s for s in lines) + "\n]\n"


def dump(obj, sort_keys=True):
    return json.dumps(obj, ensure_ascii=False, indent=2, sort_keys=sort_keys) + "\n"


def write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8", newline="\n")
    print(f"  wrote {path}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("map", help="map id, as in data/maps.json (e.g. nuoding)")
    ap.add_argument("--root", type=Path, default=ROOT, help="project root (default: parent of tools/)")
    ap.add_argument("--check", action="store_true", help="validate only, write nothing")
    ap.add_argument("--strict", action="store_true", help="treat warnings as errors")
    a = ap.parse_args()

    root, map_id = a.root, a.map
    rep = Report()
    maps = json.loads((root / "data" / "maps.json").read_text(encoding="utf-8"))
    if map_id not in maps:
        sys.exit(f"Unknown map '{map_id}'. Known maps: {', '.join(maps)}")

    src = root / "data" / "src" / map_id
    marker_rows = read_csv(src / "markers.csv", MARKER_COLUMNS, ["id", "type", "x", "y"], rep)
    if marker_rows is None:
        sys.exit(f"Missing {src / 'markers.csv'}")
    entry_rows = read_csv(src / "entries.csv", ENTRY_COLUMNS, ["id", "type", "name_en", "size"], rep) or []
    text_rows = read_csv(src / "marker_texts.csv", TEXT_COLUMNS, ["marker", "field", "en"], rep) or []
    stage_rows = read_csv(src / "stages.csv", STAGE_COLUMNS, ["trial", "stage", "stars"], rep) or []

    entries, texts, by_name = load_entries(entry_rows, rep)
    inside = make_bounds_check(maps[map_id], rep)
    markers = load_markers(marker_rows, map_id, entries, by_name, inside, rep)
    marker_texts = load_texts(text_rows, markers, rep)
    load_trials(stage_rows, markers, rep)
    cross_check(markers, entries, maps, rep)
    compare_with_previous(root / "data" / "markers" / f"{map_id}.json", markers, rep)

    print(f"{map_id}: {len(markers)} markers, {len(entries)} entries")
    for t, c in sorted(Counter(m["type"] for m in markers.values()).items()):
        print(f"  {t:<16}{c}")
    counts = Counter(m["entry"] for m in markers.values() if "entry" in m)
    for eid, e in sorted(entries.items()):
        print(f"  entry {eid:<34}{counts.get(eid, 0)}/{e['size']}")
    trials = [m for m in markers.values() if m["type"] == "divine_trial"]
    if trials:
        total = sum(len(m.get("stages", [])) for m in trials)
        print(f"  divine trial stages: {total} in {len(trials)} trial(s)")

    for w in rep.warnings:
        print(f"WARNING {w}")
    for e in rep.errors:
        print(f"ERROR   {e}")
    failed = bool(rep.errors) or (a.strict and bool(rep.warnings))
    if failed:
        sys.exit(f"\nBuild failed: {len(rep.errors)} error(s), {len(rep.warnings)} warning(s).")
    if a.check:
        print(f"\nOK ({len(rep.warnings)} warning(s)); nothing written (--check).")
        return

    print("\nWriting files:")
    write(root / "data" / "markers" / f"{map_id}.json", dump_markers(markers))
    # Entries keep the CSV row order, which mirrors the in-game exploration list.
    write(root / "data" / "entries" / f"{map_id}.json", dump(entries, sort_keys=False))
    for lang in LANGS:
        out = {}
        for eid, t in texts.items():
            item = {k: v for k, v in t[lang].items() if v}
            if item:
                out[eid] = item
        # Always write every language so the site never requests a missing file.
        write(root / "i18n" / f"entries.{map_id}.{lang}.json", dump(out, sort_keys=False))
        print(f"    {lang}: {len(out)}/{len(texts)} entries with text")
    for lang in LANGS:
        out = {}
        for mid, fields in sorted(marker_texts.items()):
            item = {f: t[lang] for f, t in fields.items() if t[lang]}
            if item:
                out[mid] = item
        write(root / "i18n" / f"markers.{map_id}.{lang}.json", dump(out, sort_keys=False))
        print(f"    {lang}: {len(out)}/{len(marker_texts)} markers with text")
    print(f"\nOK ({len(rep.warnings)} warning(s)).")


if __name__ == "__main__":
    main()
