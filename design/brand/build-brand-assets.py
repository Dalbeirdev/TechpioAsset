#!/usr/bin/env python3
"""Cut every shipped brand asset from the one master artwork.

The master (pioassets-logo-master.png) is a flat RGB render on white. Everything
the apps use is derived from it here so there is exactly one place to redo if the
logo ever changes again:

  * transparent lockups (with tagline) and wordmarks (without) for light surfaces
  * the same two recoloured for dark surfaces - the navy is what disappears on a
    dark background, so only the navy is lifted to white; the blue gradient and
    the orange are left exactly as drawn
  * the square "o + check" mark, for places that are square by nature: favicon,
    Android/iOS launcher, Apple touch icon

Un-matting: every ink in this logo has a channel at or near zero (navy 0,24,88 /
orange 248,136,8 / sky 0,183,254), so `alpha = 1 - min(rgb)/255` recovers coverage
exactly, and the colour is then un-premultiplied off the white. A luminance-based
cut would have made the orange half-transparent.

Usage:  python design/brand/build-brand-assets.py
"""
from __future__ import annotations

import io
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
MASTER = Path(__file__).with_name("pioassets-logo-master.png")
WEB_OUT = ROOT / "apps" / "web" / "public" / "brand"
MOBILE_OUT = ROOT / "apps" / "mobile" / "assets"

# Sampled off the master, not invented.
NAVY = (0x00, 0x18, 0x58)
SKY = (0x00, 0xB7, 0xFE)
DEEP = (0x00, 0x38, 0xA8)
ORANGE = (0xF8, 0x88, 0x08)
ORANGE_LIGHT = (0xFD, 0xA3, 0x0E)


# ── un-matte ─────────────────────────────────────────────────────────────────
def unmatte(path: Path) -> Image.Image:
    rgb = np.asarray(Image.open(path).convert("RGB")).astype(np.float64)
    alpha = 1.0 - rgb.min(axis=2) / 255.0
    safe = np.maximum(alpha, 1e-6)[..., None]
    fg = (rgb - 255.0 * (1.0 - safe)) / safe
    out = np.zeros(rgb.shape[:2] + (4,), dtype=np.uint8)
    out[..., :3] = np.clip(fg, 0, 255).astype(np.uint8)
    out[..., 3] = np.clip(alpha * 255.0, 0, 255).astype(np.uint8)
    return Image.fromarray(out, "RGBA")


def trim(im: Image.Image, pad: int = 0) -> Image.Image:
    box = im.getchannel("A").point(lambda v: 255 if v > 6 else 0).getbbox()
    if box is None:
        return im
    left, top, right, bottom = box
    return im.crop(
        (
            max(left - pad, 0),
            max(top - pad, 0),
            min(right + pad, im.width),
            min(bottom + pad, im.height),
        )
    )


def to_dark(im: Image.Image) -> Image.Image:
    """Lift the navy to white; leave the blues and the orange alone.

    The navy caps out at blue=88 while the darkest step of the Assets gradient is
    blue=168, so the two never overlap and a plain threshold separates them.
    """
    a = np.asarray(im).astype(np.int16).copy()
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    navy = (b < 130) & (r < 80) & (g < 110)
    a[navy, 0:3] = 255
    return Image.fromarray(a.astype(np.uint8), "RGBA")


def scaled(im: Image.Image, width: int) -> Image.Image:
    height = max(1, round(im.height * width / im.width))
    return im.resize((width, height), Image.LANCZOS)


def save(im: Image.Image, path: Path, *, colors: int | None = None) -> None:
    """`colors` palettises the PNG. Truecolour gradients + alpha make a heavy
    file (a 960px lockup lands around 200 KB); 192 palette entries hold this
    artwork's two gradients without visible banding at roughly a fifth the size."""
    path.parent.mkdir(parents=True, exist_ok=True)
    if colors:
        im = im.quantize(colors=colors, method=Image.FASTOCTREE)
    im.save(path, optimize=True)
    print(f"  {path.relative_to(ROOT)}  {im.width}x{im.height}  {path.stat().st_size // 1024} KB")


# ── the square mark ──────────────────────────────────────────────────────────
# Proportions measured off the master, in a 48-unit box mapped to the "o"'s outer
# bounds (240x231 px with a 47px ring, so a 9.4-unit ring). The check is a 24px
# stroke whose long arm crosses the ring and stops just inside its outer edge -
# faithful to the master, and what keeps the mark reading as the logo's "o"
# rather than as a generic tick-in-a-bubble.
#
# The ring is the master's flat navy, not the Assets gradient, so the mark is the
# logo rather than a lookalike. Navy on a dark tab bar or launcher would vanish,
# so every square rendering sits on the white tile below - which is invisible on
# a light ground and reads as a deliberate badge on a dark one.
CHECK = ((16.1, 26.7), (23.8, 31.9), (44.0, 12.4))
CHECK_W = 6.0
SS = 8  # supersample factor - PIL has no anti-aliased stroking


def draw_mark(size: int, *, ring=NAVY, background=None, inset=1.0) -> Image.Image:
    """Draw the mark into a square of `size` px. `inset` shrinks the artwork
    inside the canvas, which is how the Android adaptive icon keeps its safe zone."""
    s = size * SS
    canvas = Image.new("RGBA", (s, s), background if background else (0, 0, 0, 0))

    art = s * inset
    off = (s - art) / 2

    def p(x: float, y: float) -> tuple[float, float]:
        """48-unit design space -> pixels."""
        return (off + x / 48 * art, off + y / 48 * art)

    stroke = 9.4 / 48 * art
    radius = 19.3 / 48 * art
    cx, cy = p(24, 24)

    ring_layer = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    ImageDraw.Draw(ring_layer).ellipse(
        [cx - radius, cy - radius, cx + radius, cy + radius],
        outline=ring + (255,),
        width=round(stroke),
    )
    canvas = Image.alpha_composite(canvas, ring_layer)

    # Check: short arm down to the vertex, long arm up across the counter. The
    # points are the measured centreline - the master's check ends just inside
    # the ring, it does not burst out of it.
    check = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(check)
    pts = [p(*CHECK[0]), p(*CHECK[1]), p(*CHECK[2])]
    cw = round(CHECK_W / 48 * art)
    d.line(pts, fill=ORANGE + (255,), width=cw, joint="curve")
    for x, y in pts:  # round caps
        d.ellipse([x - cw / 2, y - cw / 2, x + cw / 2, y + cw / 2], fill=ORANGE + (255,))
    canvas = Image.alpha_composite(canvas, check)

    return canvas.resize((size, size), Image.LANCZOS)


def rounded(im: Image.Image, radius_ratio: float, fill) -> Image.Image:
    """Put the mark on a rounded square - iOS masks it anyway, the web does not."""
    s = im.width * SS
    tile = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    ImageDraw.Draw(tile).rounded_rectangle([0, 0, s - 1, s - 1], radius=s * radius_ratio, fill=fill)
    tile = tile.resize(im.size, Image.LANCZOS)
    return Image.alpha_composite(tile, im)


# ── svg ──────────────────────────────────────────────────────────────────────
def mark_svg() -> str:
    """The mark as vector, tile included. Sized in a 64-unit box: the 48-unit
    artwork inset to 75%, which is the same safe margin the raster icons use."""
    inset, box = 0.75, 64.0
    art = box * inset
    off = (box - art) / 2

    def n(v: float) -> str:
        return f"{v:.2f}".rstrip("0").rstrip(".")

    def q(v: float) -> str:  # a position in the 48-unit artwork
        return n(off + v / 48 * art)

    def k(v: float) -> str:  # a length (radius, stroke) - scaled, not offset
        return n(v / 48 * art)

    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">
  <rect width="64" height="64" rx="14" fill="#ffffff"/>
  <circle cx="{q(24)}" cy="{q(24)}" r="{k(19.3)}" stroke="#001858" stroke-width="{k(9.4)}"/>
  <path d="M{q(CHECK[0][0])} {q(CHECK[0][1])} L{q(CHECK[1][0])} {q(CHECK[1][1])} L{q(CHECK[2][0])} {q(CHECK[2][1])}"
        stroke="#f88808" stroke-width="{k(CHECK_W)}"
        stroke-linecap="round" stroke-linejoin="round"/>
</svg>
"""


def main() -> None:
    print("un-matting master")
    full = trim(unmatte(MASTER))
    print(f"  ink {full.width}x{full.height}")

    # The tagline sits under a gap; split on the widest empty row band.
    alpha = np.asarray(full.getchannel("A"))
    rows = (alpha > 6).sum(axis=1)
    gaps = []
    run = None
    for i, v in enumerate(rows):
        if v == 0 and run is None:
            run = i
        elif v != 0 and run is not None:
            gaps.append((run, i))
            run = None
    split = max(gaps, key=lambda gp: gp[1] - gp[0])
    cut = (split[0] + split[1]) // 2
    wordmark = trim(full.crop((0, 0, full.width, cut)))
    print(f"  wordmark {wordmark.width}x{wordmark.height}, lockup {full.width}x{full.height}")

    print("web lockups")
    for name, art in (("lockup", full), ("wordmark", wordmark)):
        for variant, img in ((name, art), (f"{name}-dark", to_dark(art))):
            save(scaled(img, 960), WEB_OUT / f"pioassets-{variant}@2x.png", colors=192)
            save(scaled(img, 480), WEB_OUT / f"pioassets-{variant}.png", colors=192)

    print("square mark")
    svg = mark_svg()
    for target in (WEB_OUT / "pioassets-mark.svg", ROOT / "apps" / "web" / "src" / "app" / "icon.svg"):
        target.write_text(svg, encoding="utf-8")
        print(f"  {target.relative_to(ROOT)}")

    white = (255, 255, 255, 255)
    save(rounded(draw_mark(180, inset=0.75), 0.22, white),
         ROOT / "apps" / "web" / "src" / "app" / "apple-icon.png")

    print("mobile icons")
    # iOS/legacy Android want an opaque square; the launcher applies its own mask.
    save(rounded(draw_mark(1024, inset=0.75), 0.0, white), MOBILE_OUT / "icon.png")
    # Adaptive icon foreground. Android draws 108dp and masks all but the middle
    # 66dp, so anything past ~61% of the canvas can be cropped by a launcher's
    # mask. The mark is a circle, so it goes right up to that limit - any smaller
    # and it reads as a stamp floating in space on the home screen. The white
    # ground behind it comes from adaptiveIcon.backgroundColor.
    save(draw_mark(1024, inset=0.58), MOBILE_OUT / "adaptive-icon.png")
    save(rounded(draw_mark(48, inset=0.75), 0.22, white), MOBILE_OUT / "favicon.png")
    save(scaled(wordmark, 720), MOBILE_OUT / "wordmark.png", colors=192)
    save(scaled(to_dark(wordmark), 720), MOBILE_OUT / "wordmark-dark.png", colors=192)

    print("social card")
    og_card(full)

    print("done")


def og_card(lockup: Image.Image) -> None:
    """Re-band the social preview card.

    The illustration has the old wordmark painted into its lower third, which no
    overlay can hide. The devices and their shadows all finish above y=494, so
    everything from there down is replaced with a white band carrying the real
    lockup - white rather than navy because the deep end of the Assets gradient
    has too little contrast against a dark bar.
    """
    src = Path(__file__).with_name("og-card-source.jpg")
    card = Image.open(src).convert("RGB")
    bar_top = 494
    draw = ImageDraw.Draw(card)
    draw.rectangle([0, bar_top, card.width, card.height], fill=(255, 255, 255))
    draw.rectangle([0, bar_top, card.width, bar_top + 5], fill=ORANGE)

    height = 88
    art = lockup.resize((round(lockup.width * height / lockup.height), height), Image.LANCZOS)
    card.paste(
        art,
        ((card.width - art.width) // 2, bar_top + 5 + ((card.height - bar_top - 5) - height) // 2),
        art,
    )
    out = ROOT / "apps" / "web" / "public" / "marketing" / "og-card.jpg"
    card.save(out, quality=88, optimize=True, progressive=True)
    print(f"  {out.relative_to(ROOT)}  {card.width}x{card.height}  {out.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
