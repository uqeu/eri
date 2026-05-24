"""Build the eri .icns dock icon from Funnel Display.

Produces an edge-to-edge 1024×1024 SVG (solid background, centered wordmark)
so macOS can apply its standard rounded-square mask without double-bezel.
Then rasterizes to the full iconset and stamps an .icns.
"""

import shutil
import subprocess
import sys
from pathlib import Path

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.ttLib import TTFont

REPO = Path(__file__).resolve().parents[1]
TTF = REPO / "ide" / "icons" / "FunnelDisplay-Regular.ttf"
ICONSET = REPO / "ide" / "icons" / "eri.iconset"
ICNS = REPO / "ide" / "icons" / "eri.icns"
SVG = REPO / "ide" / "icons" / "eri-dock.svg"

# Canvas: full bleed.
CANVAS = 1024
BG_FILL = "#FFFFFF"  # white background — macOS rounds the corners
FG_FILL = "#000000"  # black wordmark
TRACKING = -0.03  # -3% letter spacing
TARGET_HEIGHT_FRACTION = 0.50  # cap height fills 50% of canvas


def main() -> int:
    font = TTFont(str(TTF))
    cmap = font["cmap"].getBestCmap()
    upm = font["head"].unitsPerEm
    hmtx = font["hmtx"]
    ascent = font["OS/2"].sTypoAscender
    descent = font["OS/2"].sTypoDescender
    glyph_set = font.getGlyphSet()

    text = "eri"
    track_units = TRACKING * upm
    cursor = 0.0
    paths: list[str] = []
    for char in text:
        gname = cmap[ord(char)]
        pen = SVGPathPen(glyph_set)
        glyph_set[gname].draw(pen)
        d = pen.getCommands()
        if d:
            paths.append(
                f'<path d="{d}" transform="translate({cursor:.2f},0)"/>'
            )
        cursor += hmtx[gname][0] + track_units

    total_width = cursor - track_units
    cap_h = ascent - descent

    target_h = CANVAS * TARGET_HEIGHT_FRACTION
    scale = target_h / cap_h
    drawn_w = total_width * scale
    drawn_h = cap_h * scale
    tx = (CANVAS - drawn_w) / 2
    ty = (CANVAS + drawn_h) / 2 - (abs(descent) * scale)

    # Semi-transparent white plate — sits like frosted glass against the dock blur.
    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {CANVAS} {CANVAS}">
  <rect width="{CANVAS}" height="{CANVAS}" fill="{BG_FILL}" fill-opacity="0.22"/>
  <g fill="{FG_FILL}" transform="translate({tx:.2f},{ty:.2f}) scale({scale:.5f},-{scale:.5f})">
{chr(10).join('    ' + p for p in paths)}
  </g>
</svg>
"""
    SVG.write_text(svg, encoding="utf-8")
    print(f"wrote {SVG}  scale={scale:.4f}")

    # Build iconset
    if ICONSET.exists():
        shutil.rmtree(ICONSET)
    ICONSET.mkdir(parents=True)
    sizes = {
        "icon_16x16.png": 16, "icon_16x16@2x.png": 32,
        "icon_32x32.png": 32, "icon_32x32@2x.png": 64,
        "icon_128x128.png": 128, "icon_128x128@2x.png": 256,
        "icon_256x256.png": 256, "icon_256x256@2x.png": 512,
        "icon_512x512.png": 512, "icon_512x512@2x.png": 1024,
    }
    for name, px in sizes.items():
        subprocess.run([
            "rsvg-convert", str(SVG),
            "-w", str(px), "-h", str(px),
            "-o", str(ICONSET / name),
        ], check=True)
    print(f"rasterized {len(sizes)} sizes into {ICONSET}")

    if ICNS.exists():
        ICNS.unlink()
    subprocess.run(["iconutil", "-c", "icns", str(ICONSET)], check=True)
    print(f"wrote {ICNS}  size={ICNS.stat().st_size}B")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
