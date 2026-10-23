#!/usr/bin/env python3
"""
Turn painted cloud images into cut-out panels for the sky.

    python3 tools/prep_clouds.py <kind> <image> [<image> ...] [--light left|right] [--key-soft 0.15]

kind is one of: tower, hero, bank, small (see assets/clouds/README.md).

Each image should show one cloud (or one bank of cloud) painted on a plain,
even background: flat sky blue works best, because any faint fringe left
at the soft edges then matches our sky. Transparent PNGs are used as they are.

For opaque images the sky is fitted from the border as a vertical gradient.
Sky-colored areas connected to the edge of the picture become transparent,
with a soft ramp by color distance so painted edges stay soft; everything
enclosed by the cloud stays solid. The background is then "un-mixed" out of the
semi-transparent edges, so no blue halo is baked in. The result is trimmed,
scaled to at most 2048 px wide, saved to assets/clouds/, and listed in
assets/clouds/manifest.json.
"""
import argparse
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'assets', 'clouds')
MANIFEST = os.path.join(OUT, 'manifest.json')
KINDS = ('tower', 'hero', 'bank', 'small')
MAX_WIDTH = 2048


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def fit_background(rgb, b):
    """Sky behind the cloud as a smooth vertical gradient (quadratic in y per
    channel), fitted to the border pixels with outliers (cloud touching the
    edge) rejected."""
    h, w, _ = rgb.shape
    ys = np.arange(h, dtype=np.float32)
    idx = [(y, x) for y in range(h) for x in list(range(b)) + list(range(w - b, w))]
    idx += [(y, x) for y in list(range(b)) + list(range(h - b, h)) for x in range(b, w - b)]
    yy = np.array([i[0] for i in idx], dtype=np.float32)
    px = np.array([rgb[i] for i in idx])
    keep = np.ones(len(yy), bool)
    for _ in range(3):
        A = np.stack([np.ones_like(yy), yy / h, (yy / h) ** 2], 1)
        coef, *_ = np.linalg.lstsq(A[keep], px[keep], rcond=None)
        err = np.linalg.norm(px - A @ coef, axis=1)
        mad = np.median(err[keep]) + 1e-4
        keep = err < 4 * mad + 0.01
    A = np.stack([np.ones_like(ys), ys / h, (ys / h) ** 2], 1)
    bg = (A @ coef)[:, None, :]
    return np.clip(bg, 0, 1), np.percentile(err[keep], 95)


def connected_to_border(mask):
    """Pixels of `mask` reachable from the image border through `mask`."""
    # .copy(): an image made from an array can share its read-only memory,
    # and floodfill would then silently change nothing.
    img = Image.fromarray(np.where(mask, 255, 0).astype(np.uint8), 'L').copy()
    w, h = img.size
    border = [(x, 0) for x in range(w)] + [(x, h - 1) for x in range(w)] + \
             [(0, y) for y in range(h)] + [(w - 1, y) for y in range(h)]
    for xy in border:
        if img.getpixel(xy) == 255:
            ImageDraw.floodfill(img, xy, 128, thresh=0)
    return np.asarray(img) == 128


def cut_out(img, soft):
    rgba = np.asarray(img.convert('RGBA')).astype(np.float32) / 255.0
    rgb, alpha = rgba[..., :3], rgba[..., 3]
    if alpha.min() < 0.98:
        return rgb, alpha  # already transparent

    h, w = alpha.shape
    bg, spread = fit_background(rgb, max(2, min(h, w) // 100))
    dist = np.linalg.norm(rgb - bg, axis=2)
    lo = spread + 0.02  # anything this close to the sky is sky
    alpha = smoothstep(lo, lo + soft, dist)

    # Only sky-colored areas connected to the edge of the picture are sky.
    # Shadowed parts inside a cloud stay solid even if their color is close.
    sky = connected_to_border(dist < lo + soft * 0.5)
    alpha = np.where(sky, alpha, 1.0)

    # Un-mix the sky from the soft edges: px = a*cloud + (1-a)*bg.
    a = np.maximum(alpha, 1e-3)[..., None]
    rgb = np.clip(bg + (rgb - bg) / a, 0.0, 1.0)
    return rgb, alpha


def trim(rgb, alpha, margin=0.02):
    ys, xs = np.nonzero(alpha > 0.01)
    if len(xs) == 0:
        raise ValueError('no cloud found: is the background plain and even?')
    h, w = alpha.shape
    my, mx = int(h * margin), int(w * margin)
    y0, y1 = max(ys.min() - my, 0), min(ys.max() + my + 1, h)
    x0, x1 = max(xs.min() - mx, 0), min(xs.max() + mx + 1, w)
    return rgb[y0:y1, x0:x1], alpha[y0:y1, x0:x1]


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('kind', choices=KINDS)
    p.add_argument('images', nargs='+')
    p.add_argument('--light', choices=('left', 'right'), default='left',
                   help='which side the sun lights the cloud from in the painting')
    p.add_argument('--key-soft', type=float, default=0.15,
                   help='width of the soft edge ramp (color distance, 0..1.7)')
    args = p.parse_args()

    os.makedirs(OUT, exist_ok=True)
    manifest = json.load(open(MANIFEST)) if os.path.exists(MANIFEST) else {'clouds': []}
    for src in args.images:
        rgb, alpha = trim(*cut_out(Image.open(src), args.key_soft))
        out = Image.fromarray(np.dstack([rgb, alpha]).__mul__(255).round().astype(np.uint8), 'RGBA')
        if out.width > MAX_WIDTH:
            out = out.resize((MAX_WIDTH, round(out.height * MAX_WIDTH / out.width)), Image.LANCZOS)
        n = sum(1 for c in manifest['clouds'] if c['kind'] == args.kind) + 1
        name = f'{args.kind}-{n:02d}.png'
        out.save(os.path.join(OUT, name), optimize=True)
        manifest['clouds'].append({'file': name, 'kind': args.kind, 'light': args.light,
                                   'width': out.width, 'height': out.height})
        print(f'{src} -> assets/clouds/{name} ({out.width}x{out.height})')
    with open(MANIFEST, 'w') as f:
        json.dump(manifest, f, indent=2)
        f.write('\n')


if __name__ == '__main__':
    sys.exit(main())
