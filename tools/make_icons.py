"""Generates the PWA / iOS home-screen icons: a bumper plate on chalk.
Run: python3 tools/make_icons.py  (needs Pillow)."""
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "app" / "icons"
CHALK = (238, 240, 235)
IRON = (32, 37, 42)
BLUE = (30, 91, 198)
BLUE_DARK = (21, 66, 146)
RED = (208, 42, 60)


def plate(size: int, scale: float = 1.0) -> Image.Image:
    ss = 4  # supersample for smooth edges
    s = size * ss
    img = Image.new("RGB", (s, s), CHALK)
    d = ImageDraw.Draw(img)
    c = s / 2

    def circle(r, fill):
        d.ellipse((c - r, c - r, c + r, c + r), fill=fill)

    R = s * 0.40 * scale
    # a thinner red plate peeking out behind: the heavy week
    d.ellipse((c - R * 0.92 + s * 0.06 * scale, c - R * 0.92, c + R * 0.92 + s * 0.06 * scale, c + R * 0.92), fill=RED)
    circle(R, BLUE)
    circle(R * 0.86, BLUE_DARK)
    circle(R * 0.80, BLUE)
    circle(R * 0.30, CHALK)
    circle(R * 0.13, IRON)
    return img.resize((size, size), Image.LANCZOS)


OUT.mkdir(parents=True, exist_ok=True)
plate(180).save(OUT / "apple-touch-icon.png")
plate(192).save(OUT / "icon-192.png")
plate(512).save(OUT / "icon-512.png")
plate(512, scale=0.82).save(OUT / "icon-maskable-512.png")
print("icons written to", OUT)
