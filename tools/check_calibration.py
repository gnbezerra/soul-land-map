#!/usr/bin/env python3
"""Fit the game -> pixel calibration by least squares and print the residuals.

Usage:
    python tools/check_calibration.py data/maps.json nuoding data/calibration/nuoding.json

Each point in the calibration file:
    {"x": game X, "y": game Y, "px": image pixel X, "py": image pixel Y}

Model (no rotation):  px = scaleX * x + offsetX   and   py = scaleY * y + offsetY
Pixels refer to the original image (e.g. 4096x4096), origin at the top-left corner.
"""
import json
import math
import sys


def fit(us, vs):
    n = len(us)
    mu, mv = sum(us) / n, sum(vs) / n
    suu = sum((u - mu) ** 2 for u in us)
    if suu == 0:
        sys.exit("The points must vary along this axis to fit its scale.")
    scale = sum((u - mu) * (v - mv) for u, v in zip(us, vs)) / suu
    return scale, mv - scale * mu


def main():
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    maps = json.load(open(sys.argv[1], encoding="utf-8"))
    cfg = maps[sys.argv[2]]["calibration"]
    pts = json.load(open(sys.argv[3], encoding="utf-8"))
    if len(pts) < 3:
        sys.exit("Need at least 3 well-spread points (8 or more is ideal).")

    sx, ox = fit([p["x"] for p in pts], [p["px"] for p in pts])
    sy, oy = fit([p["y"] for p in pts], [p["py"] for p in pts])
    print(f"Fit: scaleX={sx:.6f} offsetX={ox:.3f}  scaleY={sy:.6f} offsetY={oy:.3f}")
    print(f"(25/7 = {25 / 7:.6f})")
    if all(cfg.get(k) is not None for k in ("scaleX", "offsetX", "scaleY", "offsetY")):
        print(f"maps.json: scaleX={cfg['scaleX']} offsetX={cfg['offsetX']} "
              f"scaleY={cfg['scaleY']} offsetY={cfg['offsetY']}")
    else:
        print("maps.json has no complete calibration yet; copy the fitted values above.")

    print("\nFit residuals (px):")
    sq = 0.0
    worst = 0.0
    for i, p in enumerate(pts):
        dx = sx * p["x"] + ox - p["px"]
        dy = sy * p["y"] + oy - p["py"]
        d = math.hypot(dx, dy)
        sq += d * d
        worst = max(worst, d)
        print(f"  {i + 1:>2}  game=({p['x']}, {p['y']})  error=({dx:+.2f}, {dy:+.2f})  |{d:.2f}|")
    print(f"\nRMS={math.sqrt(sq / len(pts)):.2f} px, worst={worst:.2f} px "
          f"(1 game unit ~ {abs(sx):.1f} px)")


if __name__ == "__main__":
    main()
