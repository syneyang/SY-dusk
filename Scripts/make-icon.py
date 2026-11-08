#!/usr/bin/env python3
"""生成「朝夕」的 App 图标：地平线上半轮太阳。

依赖 Pillow + numpy：
    python3 Scripts/make-icon.py
输出 Sources/DuskApp/Assets.xcassets/AppIcon.appiconset/icon-1024.png
"""
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "Sources" / "DuskApp" / "Assets.xcassets" / "AppIcon.appiconset" / "icon-1024.png"

SIZE = 1024
SS = 2  # 超采样倍数
W = SIZE * SS

SKY_TOP = np.array([253, 248, 240], dtype=float)
SKY_BOTTOM = np.array([243, 227, 207], dtype=float)
GROUND_TOP = np.array([244, 233, 217], dtype=float)
GROUND_BOTTOM = np.array([236, 222, 203], dtype=float)
SUN_TOP = np.array([248, 199, 143], dtype=float)
SUN_BOTTOM = np.array([219, 111, 52], dtype=float)
GLOW = np.array([250, 190, 130], dtype=float)
INK = np.array([36, 31, 27], dtype=float)

HORIZON = 0.60
SUN_RADIUS = 0.195
LINE = 0.0085


def smoothstep(t: np.ndarray) -> np.ndarray:
    t = np.clip(t, 0.0, 1.0)
    return t * t * (3 - 2 * t)


def main() -> None:
    yy, xx = np.mgrid[0:W, 0:W].astype(float)
    yn = yy / (W - 1)
    xn = xx / (W - 1)

    horizon = HORIZON * W
    cx, cy = W / 2.0, horizon

    # 天空与地面：两段竖直渐变，交界处用 smoothstep 过渡
    sky_t = smoothstep(yn / HORIZON)
    ground_t = smoothstep((yn - HORIZON) / (1 - HORIZON))
    sky = SKY_TOP[None, None, :] * (1 - sky_t[..., None]) + SKY_BOTTOM[None, None, :] * sky_t[..., None]
    ground = GROUND_TOP[None, None, :] * (1 - ground_t[..., None]) + GROUND_BOTTOM[None, None, :] * ground_t[..., None]
    below = (yn >= HORIZON)[..., None]
    img = np.where(below, ground, sky)

    # 太阳周围的暖光晕
    dist = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2) / W
    glow = np.exp(-(dist ** 2) / (2 * 0.20 ** 2)) * 0.55
    img = img * (1 - glow[..., None]) + GLOW[None, None, :] * glow[..., None]

    # 半轮太阳（只在地平线以上）
    radius = SUN_RADIUS * W
    in_circle = ((xx - cx) ** 2 + (yy - cy) ** 2) <= radius ** 2
    sun_t = smoothstep((yy - (cy - radius)) / (radius * 1.6))
    sun = SUN_TOP[None, None, :] * (1 - sun_t[..., None]) + SUN_BOTTOM[None, None, :] * sun_t[..., None]
    sun_mask = (in_circle & (yn < HORIZON))[..., None]
    img = np.where(sun_mask, sun, img)

    # 地面上的倒影：一小段随距离衰减的暖色
    below_ratio = np.clip((yn - HORIZON) / 0.20, 0.0, 1.0)
    reflect = (1 - below_ratio) ** 2 * 0.30
    reflect *= np.exp(-((xx - cx) ** 2) / (2 * (radius * 1.1) ** 2))
    reflect = np.where((yn >= HORIZON)[..., None], reflect[..., None], 0.0)
    img = img * (1 - reflect) + SUN_BOTTOM[None, None, :] * reflect

    # 地平线
    half = LINE * W / 2
    line_mask = (np.abs(yy - cy) <= half)[..., None]
    img = np.where(line_mask, INK * 0.92 + img * 0.08, img)

    # 抖动，避免大面积渐变出现色带
    rng = np.random.default_rng(7)
    img = img + rng.uniform(-0.9, 0.9, img.shape)

    arr = np.clip(img, 0, 255).astype(np.uint8)
    icon = Image.fromarray(arr, mode="RGB").resize((SIZE, SIZE), Image.LANCZOS)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    icon.save(OUT, format="PNG")
    print(f"icon -> {OUT} ({SIZE}×{SIZE})")


if __name__ == "__main__":
    main()
