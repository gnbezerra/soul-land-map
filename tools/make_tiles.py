#!/usr/bin/env python3
"""Generate a WebP tile pyramid from a map image, for Leaflet.

Usage:
    python tools/make_tiles.py nuoding.png tiles/nuoding

Convention: in pixel and tile space the origin is the top-left corner and y
grows downwards (tiles are written to {z}/{x}/{y}.webp). This is what
L.CRS.Simple uses by default: LatLng has lat pointing up, but the CRS
transformation flips the sign when converting to pixels. The max zoom is the
native one: at that zoom, 1 image pixel = 1 screen pixel. Images whose size is
not tile * 2^n get a transparent margin on the right and bottom, without
moving the origin.
"""
import argparse
import math
from pathlib import Path

from PIL import Image


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("image")
    ap.add_argument("out")
    ap.add_argument("--tile", type=int, default=256)
    ap.add_argument("--quality", type=int, default=90)
    ap.add_argument("--lossless", action="store_true", help="lossless WebP (larger files)")
    a = ap.parse_args()

    Image.MAX_IMAGE_PIXELS = None
    src = Image.open(a.image)
    if src.mode == "RGBA" and src.getchannel("A").getextrema()[0] == 255:
        src = src.convert("RGB")  # fully opaque alpha: drop it to get smaller tiles
    elif src.mode not in ("RGB", "RGBA"):
        src = src.convert("RGBA")
    w, h = src.size

    max_z = max(0, math.ceil(math.log2(max(w, h) / a.tile)))
    side = a.tile * 2 ** max_z
    if (w, h) == (side, side):
        canvas = src
    else:
        canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
        canvas.paste(src.convert("RGBA"), (0, 0))

    out = Path(a.out)
    total_files = 0
    total_bytes = 0
    for z in range(max_z, -1, -1):
        size = a.tile * 2 ** z
        level = canvas if z == max_z else canvas.resize((size, size), Image.LANCZOS)
        n = size // a.tile
        for x in range(n):
            for y in range(n):
                tile = level.crop((x * a.tile, y * a.tile, (x + 1) * a.tile, (y + 1) * a.tile))
                if tile.mode == "RGBA" and tile.getchannel("A").getextrema()[1] == 0:
                    continue  # fully transparent tile (margin only)
                path = out / str(z) / str(x) / f"{y}.webp"
                path.parent.mkdir(parents=True, exist_ok=True)
                tile.save(path, "WEBP", quality=a.quality, lossless=a.lossless, method=6)
                total_files += 1
                total_bytes += path.stat().st_size
        print(f"zoom {z}: {n}x{n} tiles")

    print(f"\n{total_files} tiles, {total_bytes / 1e6:.1f} MB in {out}")
    print(f'\nFor data/maps.json:\n  "image": {{"width": {w}, "height": {h}}},\n'
          f'  "tiles": {{"tileSize": {a.tile}, "maxNativeZoom": {max_z}, "maxZoom": {max_z + 2}}}')


if __name__ == "__main__":
    main()
