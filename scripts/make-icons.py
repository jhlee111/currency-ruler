"""Draws the app icons as PNGs with no dependencies: a full-bleed peach square with two
log-scale tick columns (the right one offset like ¥/$) and a dark reading line across.

Run from the repo root: python3 scripts/make-icons.py
"""
import math
import pathlib
import struct
import zlib

PEACH = (0xFA, 0xED, 0xE7)
TICK = (0xD2, 0x64, 0x3F)
INK = (0x3D, 0x17, 0x0B)
OUT = pathlib.Path(__file__).resolve().parent.parent / 'public' / 'icons'


def draw(size):
    px = [list(PEACH) * size for _ in range(size)]

    def rect(x0, y0, x1, y1, color):
        x0, x1 = max(0, round(x0)), min(size, round(x1))
        y0, y1 = max(0, round(y0)), min(size, round(y1))
        for y in range(y0, y1):
            row = px[y]
            for x in range(x0, x1):
                row[3 * x:3 * x + 3] = color

    # Everything sits inside the maskable safe zone (the middle ~70%).
    top, span = 0.2 * size, 0.6 * size
    thin = max(1, 0.016 * size)
    for shift, left in ((0.0, True), (0.2, False)):
        for m in (1, 1.5, 2, 3, 4, 5, 7, 10):
            f = (math.log10(m) + shift) % 1.0001
            y = top + f * span
            big = m in (1, 10)
            length = (0.22 if big else 0.15 if m in (2, 5) else 0.09) * size
            weight = thin * (1.8 if big else 1)
            x0 = 0.2 * size if left else 0.8 * size - length
            rect(x0, y - weight / 2, x0 + length, y + weight / 2, TICK)
    # The reading line, with a pill on each side like the app's glass.
    mid = top + 0.56 * span
    rect(0.14 * size, mid - 0.012 * size, 0.86 * size, mid + 0.012 * size, INK)
    for cx in (0.34 * size, 0.66 * size):
        rect(cx - 0.06 * size, mid - 0.035 * size, cx + 0.06 * size, mid + 0.035 * size, INK)
    return px


def png(size, path):
    raw = b''.join(b'\x00' + bytes(row) for row in draw(size))

    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xFFFFFFFF)

    data = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0))
    data += chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')
    path.write_bytes(data)


OUT.mkdir(parents=True, exist_ok=True)
for name, size in (('icon-192.png', 192), ('icon-512.png', 512), ('apple-touch-icon.png', 180)):
    png(size, OUT / name)
    print('wrote', OUT / name)
