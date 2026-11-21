"""Tests for tools/make_icons.py, on a made-up atlas (never the game's).

Run: python -m unittest discover -s tests
The tests that cut images need Pillow and are skipped without it (CI does not install it); the check
that categories.json and icons/ agree needs nothing and always runs.
"""
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TOOL = ROOT / "tools" / "make_icons.py"
sys.path.insert(0, str(ROOT / "tools"))
try:
    from PIL import Image
    import make_icons  # noqa: E402
except ImportError:
    Image = make_icons = None
needs_pillow = unittest.skipIf(Image is None, "Pillow is not installed")
# The output names the tool writes (its ICONS and TINTS tables), read without importing it.
ICON_NAMES = set(re.findall(r'^    "(\w+)": \(', TOOL.read_text(encoding="utf-8"), flags=re.MULTILINE))

ASSET = """%YAML 1.1
--- !u!213 &21300000
Sprite:
  m_Name: {name}
  m_Rect:
    serializedVersion: 2
    x: {x}
    y: {y}
    width: {w}
    height: {h}
  m_RD:
    settingsRaw: {settings}
"""


def make_atlas(folder, sprites, size=(128, 64)):
    """Writes an atlas PNG plus one .asset per sprite. Each sprite: name -> (x, y, w, h, drawing box
    inside the rect as (left, top, right, bottom) in top-left coordinates, settingsRaw)."""
    folder.mkdir(parents=True)
    im = Image.new("RGBA", size)
    for name, (x, y, w, h, draw, settings) in sprites.items():
        top = size[1] - y - h
        l, t, r, b = draw
        im.paste((200, 30, 30, 255), (x + l, top + t, x + r, top + b))
        (folder / f"{name}.asset").write_text(
            ASSET.format(name=name, x=x, y=y, w=w, h=h, settings=settings), encoding="utf-8")
    im.save(folder / "Atlas.png")


@needs_pillow
class CutTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.folder = self.tmp / "a" / "ExportedProject" / "Assets" / "ui" / "atlas"

    def test_y_counts_from_the_bottom_and_output_is_trimmed_square(self):
        # A 20x10 drawing inside a 32x32 rect at the atlas' bottom-left corner.
        make_atlas(self.folder, {"s": (0, 0, 32, 32, (6, 11, 26, 21), 0)})
        atlas = make_icons.load_atlas(self.folder)
        icon = make_icons.cut(atlas, make_icons.sprite_rect(self.folder, "s"))
        self.assertEqual(icon.size, (20, 20))
        alpha = icon.getchannel("A")
        self.assertEqual(alpha.getbbox(), (0, 5, 20, 15), "centered vertically")
        self.assertEqual(icon.getpixel((10, 10))[:3], (200, 30, 30))

    def test_large_sprites_are_scaled_down(self):
        make_atlas(self.folder, {"big": (0, 0, 100, 60, (0, 0, 100, 60), 0)}, size=(128, 64))
        atlas = make_icons.load_atlas(self.folder)
        icon = make_icons.cut(atlas, make_icons.sprite_rect(self.folder, "big"))
        self.assertEqual(icon.size, (make_icons.MAX_SIZE, make_icons.MAX_SIZE))

    def test_tint_multiplies_the_color_and_keeps_alpha(self):
        icon = Image.new("RGBA", (2, 1))
        icon.putpixel((0, 0), (255, 255, 255, 255))
        icon.putpixel((1, 0), (20, 60, 200, 128))
        out = make_icons.tint(icon, (214, 120, 255))
        self.assertEqual(out.getpixel((0, 0)), (214, 120, 255, 255), "white becomes the color")
        self.assertEqual(out.getpixel((1, 0)), (16, 28, 200, 128), "darker stays darker, alpha kept")

    def test_errors(self):
        make_atlas(self.folder, {
            "rotated": (0, 0, 16, 16, (0, 0, 16, 16), 3),
            "outside": (120, 0, 32, 32, (0, 0, 4, 4), 0),
            "empty": (40, 0, 16, 16, (0, 0, 0, 0), 0),
        })
        atlas = make_icons.load_atlas(self.folder)
        with self.assertRaisesRegex(make_icons.IconError, "settingsRaw 3"):
            make_icons.sprite_rect(self.folder, "rotated")
        with self.assertRaisesRegex(make_icons.IconError, "not found"):
            make_icons.sprite_rect(self.folder, "missing")
        with self.assertRaisesRegex(make_icons.IconError, "outside"):
            make_icons.cut(atlas, make_icons.sprite_rect(self.folder, "outside"))
        with self.assertRaisesRegex(make_icons.IconError, "empty"):
            make_icons.cut(atlas, make_icons.sprite_rect(self.folder, "empty"))


class CliTest(unittest.TestCase):
    @needs_pillow
    def test_reports_every_missing_icon_and_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            r = subprocess.run([sys.executable, str(TOOL), "--raw", str(Path(tmp) / "raw"), "--out", str(Path(tmp) / "out")],
                               capture_output=True, text=True)
            self.assertEqual(r.returncode, 1)
            self.assertEqual(r.stderr.count("ERROR"), len(make_icons.ICONS) + len(make_icons.TINTS))

    def test_every_icon_is_referenced_by_categories(self):
        import json
        cats = json.loads((ROOT / "data" / "categories.json").read_text(encoding="utf-8"))
        used = {f for t in cats["types"].values() for f in (t.get("icon"), t.get("iconFound")) if f}
        self.assertTrue(ICON_NAMES, "ICONS table found in the tool")
        self.assertEqual(used, {f"icons/{n}.png" for n in ICON_NAMES}, "categories.json and ICONS agree")
        if make_icons:
            self.assertEqual(ICON_NAMES, set(make_icons.ICONS) | set(make_icons.TINTS))
        for f in used:
            self.assertTrue((ROOT / f).exists(), f"{f} is committed")


if __name__ == "__main__":
    unittest.main()
