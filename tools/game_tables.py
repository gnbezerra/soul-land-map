"""Read the game's config tables (the .xc files of the installed client).

The game keeps its data tables in a format of its own, reverse-engineered here (see README "Game data"):

    'LRGB', then six big-endian u32: column count, row count + 3, three unknown, data size
    column count x 3 header values: description (Chinese), type name, column name
    rows, each: big-endian u16 length (counting itself), then one tagged value per column

Value tags:
    00            zero / false / empty
    01..04        unsigned big-endian integer of that many bytes
    05            float32
    06            empty string
    07            vector2 (2 x float32)
    08            vector3 (3 x float32)
    16            string, varint length + UTF-8
    26            string, u16 length + UTF-8

Each config table may exist twice: in BuildRes/config (the installed build) and in Res/config (downloaded
updates). BuildRes/internal_file_list.txt and Res/external_file_list.txt give each file a version; the higher
one is the one the game uses.

Only the standard library; nothing here touches the repo.
"""
import struct
from pathlib import Path

MAGIC = b"LRGB"


class FormatError(ValueError):
    pass


class _Reader:
    def __init__(self, data, pos):
        self.data, self.pos = data, pos

    def take(self, n):
        if self.pos + n > len(self.data):
            raise FormatError(f"unexpected end of data at {self.pos:#x}")
        chunk = self.data[self.pos:self.pos + n]
        self.pos += n
        return chunk

    def varint(self):
        value = shift = 0
        while True:
            byte = self.take(1)[0]
            value |= (byte & 0x7F) << shift
            shift += 7
            if not byte & 0x80:
                return value

    def value(self):
        at = self.pos
        tag = self.take(1)[0]
        if tag == 0x00:
            return 0
        if 0x01 <= tag <= 0x04:
            return int.from_bytes(self.take(tag), "big")
        if tag == 0x05:
            return struct.unpack(">f", self.take(4))[0]
        if tag == 0x06:
            return ""
        if tag == 0x07:
            return list(struct.unpack(">ff", self.take(8)))
        if tag == 0x08:
            return list(struct.unpack(">fff", self.take(12)))
        if tag == 0x16:
            return self.take(self.varint()).decode("utf-8")
        if tag == 0x26:
            return self.take(int.from_bytes(self.take(2), "big")).decode("utf-8")
        raise FormatError(f"unknown value tag {tag:#04x} at {at:#x}")


def parse_table(data):
    """Parse one .xc file. Returns {"columns": [names], "types": [...], "desc": [...], "rows": [dict]}."""
    if data[:4] != MAGIC:
        raise FormatError("not an .xc table (no LRGB magic)")
    if len(data) < 28:
        raise FormatError("header too short")
    cols, _rows, _a, _b, _c, size = struct.unpack(">6I", data[4:28])
    r = _Reader(data, 28)
    header = [r.value() for _ in range(cols * 3)]
    desc, types, names = header[:cols], header[cols:2 * cols], header[2 * cols:]
    if len(data) - r.pos != size:
        raise FormatError(f"data size {size} does not match the {len(data) - r.pos} bytes after the header")
    rows = []
    while r.pos < len(data):
        start = r.pos
        length = int.from_bytes(r.take(2), "big")
        values = [r.value() for _ in range(cols)]
        if r.pos != start + length:
            raise FormatError(f"row at {start:#x} declares {length} bytes but holds {r.pos - start}")
        rows.append(dict(zip(names, values)))
    return {"columns": names, "types": types, "desc": desc, "rows": rows}


def _file_versions(path):
    """{relative path: version} from a BuildRes/Res file list (tab-separated: path, version, ...)."""
    versions = {}
    try:
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return versions
    for line in lines:
        parts = line.split("\t")
        if len(parts) >= 2 and parts[1].strip().isdigit():
            versions[parts[0].strip()] = int(parts[1])
    return versions


class GameFiles:
    """The game's config tables, from its install folder (the one holding BuildRes/ and Res/)."""

    def __init__(self, root):
        self.root = Path(root)
        if not (self.root / "BuildRes" / "config").is_dir():
            raise FileNotFoundError(f"{self.root} does not look like the game folder (no BuildRes/config)")
        self._build = _file_versions(self.root / "BuildRes" / "internal_file_list.txt")
        self._res = _file_versions(self.root / "Res" / "external_file_list.txt")
        self._cache = {}

    def path(self, name):
        """The file the game uses for config table `name` (without .xc)."""
        rel = f"config/{name}.xc"
        build, res = self.root / "BuildRes" / rel, self.root / "Res" / rel
        if res.is_file() and (not build.is_file() or self._res.get(rel, -1) > self._build.get(rel, -1)):
            return res
        if build.is_file():
            return build
        raise FileNotFoundError(f"config table '{name}' not found")

    def rows(self, name):
        if name not in self._cache:
            path = self.path(name)
            try:
                self._cache[name] = parse_table(path.read_bytes())["rows"]
            except FormatError as e:
                raise FormatError(f"{path}: {e}") from None
        return self._cache[name]

    def texts(self, lang):
        """{key: text} for 'en', 'pt' or 'zh'."""
        table = {"zh": "language", "en": "language_english", "pt": "language_portuguese"}[lang]
        return {r["Id"]: r["Zhs"] for r in self.rows(table)}
