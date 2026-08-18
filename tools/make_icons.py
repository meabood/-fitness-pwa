#!/usr/bin/env python3
"""LOCKD app icon generator.

Design rationale (per brief): extremely minimal, near-white background, calm and
premium, a mostly dark-neutral geometric mark with a tiny restrained use of the
existing app blue, flat, recognizable when small. No text, no gym cliches.

The mark is an abstract "L" formed as a bracket corner (vertical + horizontal
stroke) with rounded caps — reads as L / locked-in / a foundation. A short blue
segment "completes" the corner (progress/completion, a subtle lock latch)
without being a literal padlock. High contrast so it stays clear at Home-Screen
size.
"""
from PIL import Image, ImageDraw

# Palette — pulled to match the app's near-white surface + slate-blue accent.
BG        = (251, 251, 253, 255)   # --surface near-white (#fbfbfd)
INK       = (28, 32, 38, 255)      # dark neutral (not pure black — premium)
BLUE      = (58, 110, 214, 255)    # restrained accent (app slate-blue family)

def rounded_cap_line(d, p0, p1, w, fill):
    """Draw a thick line with round caps (PIL line + end circles)."""
    d.line([p0, p1], fill=fill, width=w)
    r = w // 2
    for (x, y) in (p0, p1):
        d.ellipse([x - r, y - r, x + r, y + r], fill=fill)

def draw_mark(size, pad_ratio, bg=BG, rounded_bg=False, radius_ratio=0.0):
    """Render the LOCKD mark at a given pixel size on a solid background.

    Supersampled 4x then downscaled for clean flat edges.
    """
    S = size * 4
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # Background (optionally rounded for non-maskable icons)
    if rounded_bg and radius_ratio > 0:
        rr = int(S * radius_ratio)
        d.rounded_rectangle([0, 0, S - 1, S - 1], radius=rr, fill=bg)
    else:
        d.rectangle([0, 0, S, S], fill=bg)

    pad = int(S * pad_ratio)
    box = (pad, pad, S - pad, S - pad)
    bx0, by0, bx1, by1 = box
    inner = bx1 - bx0

    stroke = int(inner * 0.16)          # mark thickness
    # Vertical stroke of the L (left), from top to bottom
    vx = bx0 + int(inner * 0.30)
    v_top = by0 + int(inner * 0.12)
    v_bot = by1 - int(inner * 0.12)
    # Horizontal stroke of the L (foot), from the corner rightward
    h_left = vx
    h_right = bx1 - int(inner * 0.30)
    hy = v_bot

    # Dark neutral L
    rounded_cap_line(d, (vx, v_top), (vx, hy), stroke, INK)
    rounded_cap_line(d, (h_left, hy), (h_right, hy), stroke, INK)

    # Blue "completion" latch: a short segment rising from the L's foot end,
    # suggesting locked-in / progress closing the shape. Restrained + small.
    latch_x = h_right
    latch_top = hy - int(inner * 0.18)
    rounded_cap_line(d, (latch_x, hy), (latch_x, latch_top), stroke, BLUE)

    return img.resize((size, size), Image.LANCZOS)

def save(img, path):
    img.convert("RGBA").save(path, "PNG")
    print("wrote", path)

if __name__ == "__main__":
    import os
    out = os.path.join(os.path.dirname(__file__), "..", "icons")
    out = os.path.abspath(out)

    # Standard icons: near-white square, subtle rounded corners for the browser
    # favicon/any-purpose use (home screens apply their own masking).
    save(draw_mark(192, 0.20, rounded_bg=True, radius_ratio=0.22), os.path.join(out, "icon-192.png"))
    save(draw_mark(512, 0.20, rounded_bg=True, radius_ratio=0.22), os.path.join(out, "icon-512.png"))

    # Apple touch icon: iOS masks corners itself, so use a full-bleed square bg
    # with a bit more padding so the mark isn't clipped by the superellipse.
    save(draw_mark(180, 0.24, rounded_bg=False), os.path.join(out, "apple-touch-icon.png"))

    # Maskable: full-bleed background with generous safe-zone padding (mark well
    # inside the inner 80% so Android/iOS masks never clip it).
    save(draw_mark(512, 0.30, rounded_bg=False), os.path.join(out, "icon-maskable-512.png"))
