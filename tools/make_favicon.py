#!/usr/bin/env python3
"""Generate favicon.ico (16 and 32 px) and apple-touch-icon.png (180 px) from the map pin
drawn in favicon.svg.

Usage:
    python tools/make_favicon.py            # writes into the project root
    python tools/make_favicon.py --root DIR

Pillow cannot read SVG, so the pin is drawn here again with the same geometry (32x32 units,
see favicon.svg); keep both in sync. Each size is drawn at 16x and downsampled, which gives
anti-aliased edges. The touch icon gets the site background and some padding: iOS fills
transparent pixels with black and rounds the corners itself.
"""
import argparse
import math
from pathlib import Path

from PIL import Image, ImageDraw

ORANGE = "#f5a524"
DARK = "#0f1418"
STROKE = 1.6
HOLE = (16, 12.8, 3.6)  # cx, cy, r
SUPERSAMPLE = 16


def bezier(p0, p1, p2, p3, steps=48):
    for i in range(1, steps + 1):
        t = i / steps
        u = 1 - t
        yield tuple(u**3 * a + 3 * u * u * t * b + 3 * u * t * t * c + t**3 * d for a, b, c, d in zip(p0, p1, p2, p3))


def pin_outline():
    """The favicon.svg path as a polygon, in 32x32 units."""
    pts = [(16, 30.5)]
    pts += bezier((16, 30.5), (16, 30.5), (6.5, 20.8), (6.5, 12.8))
    # Upper half circle, from (6.5, 12.8) over the top to (25.5, 12.8).
    pts += [(16 - 9.5 * math.cos(a), 12.8 - 9.5 * math.sin(a)) for a in (math.pi * i / 96 for i in range(1, 97))]
    pts += bezier((25.5, 12.8), (25.5, 20.8), (16, 30.5), (16, 30.5))
    return pts


def render(size, view=(0, 0, 32), background=None):
    """Draws the pin; view = (x, y, width) of the 32-unit area shown, as an SVG viewBox."""
    big = size * SUPERSAMPLE
    vx, vy, vw = view
    k = big / vw

    def px(p):
        return ((p[0] - vx) * k, (p[1] - vy) * k)

    img = Image.new("RGBA", (big, big), background or (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    outline = [px(p) for p in pin_outline()]
    draw.polygon(outline, fill=ORANGE)
    draw.line(outline + outline[:1], fill=DARK, width=round(STROKE * k), joint="curve")
    cx, cy, r = HOLE
    x, y = px((cx, cy))
    draw.ellipse((x - r * k, y - r * k, x + r * k, y + r * k), fill=DARK)
    return img.resize((size, size), Image.LANCZOS)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--root", default=Path(__file__).resolve().parent.parent, type=Path)
    args = ap.parse_args()

    icons = [render(16), render(32)]
    icons[1].save(args.root / "favicon.ico", format="ICO", sizes=[(16, 16), (32, 32)], append_images=[icons[0]])
    # Same padding as a 40-unit viewBox around the 32-unit pin.
    render(180, view=(-4, -4, 40), background=DARK).convert("RGB").save(args.root / "apple-touch-icon.png", optimize=True)
    print(f"wrote favicon.ico and apple-touch-icon.png in {args.root}")


if __name__ == "__main__":
    main()
