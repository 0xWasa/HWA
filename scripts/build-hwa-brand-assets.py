from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFont


ROOT = Path(__file__).resolve().parents[1]
BRAND_DIR = ROOT / "frontend" / "public" / "brand"
APP_DIR = ROOT / "frontend" / "src" / "app"
BACKGROUND = (8, 10, 18, 255)


def crop_alpha(image: Image.Image, padding_ratio: float = 0.035) -> Image.Image:
    image = image.convert("RGBA")
    bounds = image.getchannel("A").getbbox()
    if bounds is None:
        raise RuntimeError("The approved wordmark has no visible pixels")
    cropped = image.crop(bounds)
    pad_x = round(cropped.width * padding_ratio)
    pad_y = round(cropped.height * padding_ratio)
    canvas = Image.new("RGBA", (cropped.width + pad_x * 2, cropped.height + pad_y * 2))
    canvas.alpha_composite(cropped, (pad_x, pad_y))
    return canvas


def contain(image: Image.Image, width: int, height: int) -> Image.Image:
    ratio = min(width / image.width, height / image.height)
    return image.resize((round(image.width * ratio), round(image.height * ratio)), Image.Resampling.LANCZOS)


def rounded_icon(wordmark: Image.Image, size: int) -> Image.Image:
    scale = 4
    working = size * scale
    icon = Image.new("RGBA", (working, working))
    draw = ImageDraw.Draw(icon)
    inset = round(working * 0.035)
    draw.rounded_rectangle(
        (inset, inset, working - inset, working - inset),
        radius=round(working * 0.23),
        fill=BACKGROUND,
        outline=(40, 46, 68, 255),
        width=max(1, round(working * 0.012)),
    )
    mark = contain(wordmark, round(working * 0.86), round(working * 0.56))
    icon.alpha_composite(mark, ((working - mark.width) // 2, (working - mark.height) // 2))
    return icon.resize((size, size), Image.Resampling.LANCZOS)


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    candidates = [
        Path("C:/Windows/Fonts") / ("segoeuib.ttf" if bold else "segoeui.ttf"),
        Path("/usr/share/fonts/truetype/dejavu")
        / ("DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf"),
    ]
    for candidate in candidates:
        if candidate.is_file():
            return ImageFont.truetype(str(candidate), size=size)
    raise RuntimeError("No supported banner font found")


def build_banner(wordmark: Image.Image) -> Image.Image:
    source = Image.open(BRAND_DIR / "hwa-banner-master.png").convert("RGB")
    target_width, target_height = 1500, 500
    ratio = max(target_width / source.width, target_height / source.height)
    source = source.resize(
        (round(source.width * ratio), round(source.height * ratio)),
        Image.Resampling.LANCZOS,
    )
    left = max(0, (source.width - target_width) // 2)
    top = max(0, (source.height - target_height) // 2)
    banner = source.crop((left, top, left + target_width, top + target_height)).convert("RGBA")
    banner = ImageEnhance.Contrast(banner).enhance(1.03)

    # Strengthen the calm logo zone without hiding the generated field lines.
    overlay = Image.new("RGBA", banner.size)
    overlay_data = []
    for y in range(target_height):
        for x in range(target_width):
            alpha = round(105 * max(0.0, 1.0 - x / 850.0) ** 1.8)
            overlay_data.append((3, 5, 12, alpha))
    overlay.putdata(overlay_data)
    banner.alpha_composite(overlay)

    mark = contain(wordmark, 520, 230)
    banner.alpha_composite(mark, (86, 118))

    draw = ImageDraw.Draw(banner)
    draw.text(
        (98, 352),
        "HYPER WORLD ASSETS",
        font=font(24, bold=True),
        fill=(244, 247, 255, 255),
    )
    draw.text(
        (98, 391),
        "NFT liquidity, drawn on HyperEVM.",
        font=font(19),
        fill=(166, 177, 205, 255),
    )
    return banner.convert("RGB")


def main() -> None:
    wordmark = crop_alpha(Image.open(BRAND_DIR / "hwa-logo.png"))
    if wordmark.width > 1200:
        wordmark = contain(wordmark, 1200, 600)
    wordmark.save(BRAND_DIR / "hwa-wordmark.png", optimize=True)

    icon = rounded_icon(wordmark, 512)
    icon.save(APP_DIR / "icon.png", optimize=True)
    rounded_icon(wordmark, 180).save(APP_DIR / "apple-icon.png", optimize=True)
    rounded_icon(wordmark, 256).save(
        APP_DIR / "favicon.ico",
        format="ICO",
        sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )

    build_banner(wordmark).save(BRAND_DIR / "hwa-banner.png", quality=94, optimize=True)
    print("Built approved HWA wordmark, favicon/app icons, and 1500x500 banner.")


if __name__ == "__main__":
    main()
