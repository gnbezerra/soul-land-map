#!/usr/bin/env python3
"""Cut the marker icons out of the game's UI atlases into icons/.

Usage:
    python tools/make_icons.py                 # reads maps/icons/raw, writes icons/
    python tools/make_icons.py --raw DIR --out DIR

Input: each atlas exported with AssetRipper ("Export project") into <raw>/<atlas>/, which gives
ExportedProject/Assets/ui/atlas/ with the atlas PNG and one <sprite>.asset (YAML) per sprite.
The sprite's m_Rect is its place in the atlas, in pixels, with y counted from the bottom.
Only plain rectangles are supported (settingsRaw 0: not rotated, not tightly packed).

Output: one PNG per entry of ICONS, plus one per entry of TINTS (an icon of ICONS multiplied by a color), trimmed to the drawing (alpha > ALPHA_CUT) and centered on a
transparent square, so every icon fills its box the same way. Icons larger than MAX_SIZE are
scaled down. data/categories.json refers to the output names.

The raw atlases are game assets and stay out of git (maps/ is ignored); only the output is
committed (CLAUDE.md, "Game assets").
"""
import argparse
import re
import sys
from pathlib import Path

from PIL import Image

# Output name -> (atlas folder under --raw, sprite name). Which sprite is which was settled with
# the owner by comparing them with the game's map filters and in-world screenshots.
ICONS = {
    "chest": ("worldmappanel", "dt_icon_bx"),                     # the game's "Treasure Chest Marker"
    "chest_contract": ("worldmappanel", "icon_dtts_bx"),
    "chest_contract_open": ("worldmappanel", "dt_icon_bx2"),      # left on the map once opened
    "divine_trial": ("worldmappanel", "explore_mapicon_active"),
    "crystal": ("commonui", "tangmen_icon_crystallize"),          # the Purple Demon Eye indicator
    "encounter": ("worlduipanel", "general_ico_qiyu01"),          # above the next NPC to talk to
    "teleport": ("worldmappanel", "teleport_mapicon_active"),
    "viewpoint": ("worldmappanel", "scenicspot_mapicon_active"),
    "portal": ("worldmappanel", "dt_icon_csd"),
    "book": ("commonui", "handbook_icon_title"),
    "boss": ("worldmappanel", "sjsl_icon_boss"),
}
# Output name -> (icon of ICONS, RGB it is multiplied by): white turns into the color, the outline stays dark.
# The respawned chests are the chest in purple, after the Purple Demon Eye that shows them (chosen with the
# owner in a preview against a badge, which the map hides when zoomed out).
TINTS = {
    "chest_respawn": ("chest", (214, 120, 255)),
}
ALPHA_CUT = 16
MAX_SIZE = 64

RECT = re.compile(r"m_Rect:\s*\n\s*serializedVersion: \d+\s*\n\s*x: ([\d.]+)\s*\n\s*y: ([\d.]+)"
                  r"\s*\n\s*width: ([\d.]+)\s*\n\s*height: ([\d.]+)")
SETTINGS = re.compile(r"settingsRaw: (\d+)")


class IconError(Exception):
    pass


def atlas_dir(raw, atlas):
    return raw / atlas / "ExportedProject" / "Assets" / "ui" / "atlas"


def load_atlas(folder):
    pngs = sorted(folder.glob("*.png"))
    if len(pngs) != 1:
        raise IconError(f"{folder}: expected one atlas PNG, found {len(pngs)}")
    return Image.open(pngs[0]).convert("RGBA")


def sprite_rect(folder, sprite):
    path = folder / f"{sprite}.asset"
    if not path.exists():
        raise IconError(f"{path}: sprite not found")
    text = path.read_text(encoding="utf-8")
    rect = RECT.search(text)
    if not rect:
        raise IconError(f"{path}: no m_Rect")
    settings = SETTINGS.search(text)
    if settings and settings.group(1) != "0":
        raise IconError(f"{path}: settingsRaw {settings.group(1)} (rotated or tight sprites are not supported)")
    return tuple(round(float(v)) for v in rect.groups())


def cut(atlas, rect):
    x, y, w, h = rect
    top = atlas.height - y - h  # Unity counts y from the bottom
    if x < 0 or top < 0 or x + w > atlas.width or top + h > atlas.height:
        raise IconError(f"rect {rect} is outside the {atlas.width}x{atlas.height} atlas")
    sprite = atlas.crop((x, top, x + w, top + h))
    box = sprite.getchannel("A").point(lambda a: 255 if a > ALPHA_CUT else 0).getbbox()
    if not box:
        raise IconError(f"rect {rect} is empty")
    sprite = sprite.crop(box)
    side = max(sprite.size)
    square = Image.new("RGBA", (side, side))
    square.paste(sprite, ((side - sprite.width) // 2, (side - sprite.height) // 2))
    if side > MAX_SIZE:
        square = square.resize((MAX_SIZE, MAX_SIZE), Image.LANCZOS)
    return square


def tint(icon, rgb):
    """The icon with each channel multiplied by `rgb` (0-255); alpha unchanged."""
    r, g, b, a = icon.split()
    r, g, b = (band.point(lambda v, k=k: v * k // 255) for band, k in zip((r, g, b), rgb))
    return Image.merge("RGBA", (r, g, b, a))


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    root = Path(__file__).resolve().parent.parent
    ap.add_argument("--raw", type=Path, default=root / "maps" / "icons" / "raw")
    ap.add_argument("--out", type=Path, default=root / "icons")
    a = ap.parse_args(argv)

    atlases, errors = {}, []
    a.out.mkdir(parents=True, exist_ok=True)
    icons = {}
    for name, (atlas, sprite) in ICONS.items():
        try:
            folder = atlas_dir(a.raw, atlas)
            if atlas not in atlases:
                atlases[atlas] = load_atlas(folder)
            icon = cut(atlases[atlas], sprite_rect(folder, sprite))
            icon.save(a.out / f"{name}.png", optimize=True)
            icons[name] = icon
            print(f"{name}.png  {icon.width}x{icon.height}  ({atlas}/{sprite})")
        except (IconError, OSError) as e:
            errors.append(f"ERROR {name}: {e}")
    for name, (base, rgb) in TINTS.items():
        if base not in icons:
            errors.append(f"ERROR {name}: its base icon '{base}' was not made")
            continue
        tint(icons[base], rgb).save(a.out / f"{name}.png", optimize=True)
        print(f"{name}.png  {base}.png tinted {rgb}")
    for e in errors:
        print(e, file=sys.stderr)
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
