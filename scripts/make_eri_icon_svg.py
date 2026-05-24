"""Generate the eri activity-bar SVG from Funnel Display.

Renders the lowercase word "eri" at the brand's letter-spacing (-3%) into a
single-color SVG that VSCode tints via currentColor.
"""

import sys
from pathlib import Path

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.ttLib import TTFont

TTF = Path(sys.argv[1] if len(sys.argv) > 1 else "FunnelDisplay-SemiBold.ttf")
OUT = Path(sys.argv[2] if len(sys.argv) > 2 else "eri-icon.svg")
TRACKING = float(sys.argv[3]) if len(sys.argv) > 3 else -0.03  # -3% per spec (range 0 to -5%)
VIEWBOX = 16  # square viewBox
PADDING = 0.5  # px on each side


def main() -> int:
    font = TTFont(str(TTF))
    cmap = font["cmap"].getBestCmap()
    upm = font["head"].unitsPerEm
    hmtx = font["hmtx"]
    ascent = font["OS/2"].sTypoAscender
    descent = font["OS/2"].sTypoDescender
    glyph_set = font.getGlyphSet()

    # Compose path: extract per-glyph SVG path and translate horizontally.
    text = "eri"
    track_units = TRACKING * upm  # font-unit tracking per glyph gap
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
        advance = hmtx[gname][0]
        cursor += advance + track_units

    total_width = cursor - track_units  # remove trailing gap
    cap_height = ascent - descent

    # Scale to fit viewBox with padding. Glyph y-axis flips: SVG y is down.
    inner = VIEWBOX - 2 * PADDING
    scale = inner / max(total_width, cap_height)
    drawn_w = total_width * scale
    drawn_h = cap_height * scale
    tx = (VIEWBOX - drawn_w) / 2
    ty = (VIEWBOX + drawn_h) / 2  # baseline goes here; descent extends below

    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {VIEWBOX} {VIEWBOX}" fill="currentColor">
  <g transform="translate({tx:.3f},{ty:.3f}) scale({scale:.5f},-{scale:.5f})">
    {chr(10).join('    ' + p for p in paths)}
  </g>
</svg>
"""
    OUT.write_text(svg, encoding="utf-8")
    print(f"wrote {OUT}  size={OUT.stat().st_size}B  glyphs={len(paths)} scale={scale:.4f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
