from pathlib import Path

from PIL import Image, ImageDraw


OUTPUT_DIR = Path(__file__).resolve().parent.parent / "public"
SCALE = 4
CANVAS = 512


def scaled_points(points: list[tuple[int, int]]) -> list[tuple[int, int]]:
    return [(x * SCALE, y * SCALE) for x, y in points]


image = Image.new("RGB", (CANVAS * SCALE, CANVAS * SCALE), "#f8f5e9")
draw = ImageDraw.Draw(image)
draw.rounded_rectangle(
    (0, 0, CANVAS * SCALE - 1, CANVAS * SCALE - 1),
    radius=112 * SCALE,
    fill="#f8f5e9",
)
draw.polygon(
    scaled_points([
        (88, 112), (160, 112), (196, 314), (256, 168), (304, 168),
        (364, 314), (400, 112), (472, 112), (405, 400), (337, 400),
        (280, 263), (223, 400), (155, 400),
    ]),
    fill="#24252a",
)
draw.ellipse(
    ((352 * SCALE), (48 * SCALE), (464 * SCALE), (160 * SCALE)),
    fill="#d8e642",
    outline="#24252a",
    width=16 * SCALE,
)

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
for size in (180, 192, 512):
    icon = image.resize((size, size), Image.Resampling.LANCZOS)
    icon.save(OUTPUT_DIR / f"watchroom-icon-{size}.png", optimize=True)
