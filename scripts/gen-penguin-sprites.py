#!/usr/bin/env python3
"""Generate pixel-art penguin sprite sheets for kbox kernel house visualization.

Style: tinyoffice-inspired tall characters with high detail and clear
silhouette. Each penguin is drawn in a 16x28 frame with a rounded body,
large expressive eyes, visible beak and feet, and wing animations.

Outputs:
  web/art/penguin-base.png    -- 7x3 sprite sheet (112x84), resident Tux
  web/art/penguin-guest.png   -- 7x3 sprite sheet, guest variant (teal)
  web/art/acc-hat.png         -- 7x1 accessory strip (112x28)
  web/art/acc-folder.png      -- 7x1 accessory strip
  web/art/acc-stopwatch.png   -- 7x1 accessory strip
  web/art/acc-memblock.png    -- 7x1 accessory strip
  web/art/acc-envelope.png    -- 7x1 accessory strip

Frame layout (7 cols): idle, walk1, walk2, walk3, type1, type2, error
Row layout (3 rows):   down (front), up (back), left/right (side)
Each frame: 16x28 pixels.
"""

import struct, zlib, os

FRAME_W, FRAME_H = 16, 28
COLS, ROWS = 7, 3
SHEET_W, SHEET_H = FRAME_W * COLS, FRAME_H * ROWS
CLEAR = (0, 0, 0, 0)

# Tux palette (warm, high contrast)
BODY    = (25, 25, 40, 255)      # deep blue-black
BELLY   = (235, 235, 245, 255)   # bright white
BEAK    = (255, 185, 50, 255)    # warm gold-orange
FEET    = (255, 160, 30, 255)    # orange
EYE_W   = (255, 255, 255, 255)   # eye white
PUPIL   = (12, 12, 25, 255)     # near-black pupil
CHEEK   = (255, 140, 140, 255)   # rosy cheek
OUTLINE = (15, 15, 28, 255)     # dark outline for definition

# Guest variant
G_BODY  = (35, 75, 105, 255)
G_BELLY = (185, 220, 240, 255)

# Accessories
HAT_RED   = (220, 55, 80, 255)
HAT_GOLD  = (255, 215, 0, 255)
FOLDER_Y  = (255, 200, 60, 255)
FOLDER_T  = (220, 170, 40, 255)
WATCH_S   = (180, 185, 200, 255)
WATCH_F   = (240, 240, 255, 255)
MEM_G     = (80, 200, 120, 255)
MEM_D     = (50, 160, 90, 255)
ENV_C     = (255, 240, 210, 255)
ENV_S     = (220, 55, 80, 255)


def make_png(width, height, pixels):
    def chunk(ct, d):
        c = ct + d
        return struct.pack('>I', len(d)) + c + struct.pack('>I', zlib.crc32(c) & 0xFFFFFFFF)
    raw = b''
    for y in range(height):
        raw += b'\x00'
        for x in range(width):
            raw += struct.pack('BBBB', *pixels[y * width + x])
    sig = b'\x89PNG\r\n\x1a\n'
    ihdr = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)
    return sig + chunk(b'IHDR', ihdr) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')


def px(buf, w, x, y, c):
    h = len(buf) // w
    if 0 <= x < w and 0 <= y < h:
        buf[y * w + x] = c

def rect(buf, w, x0, y0, rw, rh, c):
    for dy in range(rh):
        for dx in range(rw):
            px(buf, w, x0 + dx, y0 + dy, c)


def tux(buf, w, fx, fy, facing, anim, body, belly):
    """Draw one penguin frame. 16x28, centered body ~12px wide, ~20px tall."""
    ox = fx * FRAME_W
    oy = fy * FRAME_H

    bob = {1: -1, 2: -2, 3: -1}.get(anim, 0)
    jit = 1 if anim == 6 else 0
    cx = ox + 8 + jit
    base_y = oy + 24 + bob  # feet baseline

    if facing == 0:  # FRONT
        # Head (round: 10w x 7h with clipped corners)
        hy = base_y - 20
        rect(buf, w, cx-5, hy, 10, 7, body)
        for c in [(cx-5, hy), (cx+4, hy), (cx-5, hy+1), (cx+4, hy+1)]:
            px(buf, w, c[0], c[1], CLEAR)  # round top corners
        # Outline top of head
        for dx in range(-4, 5):
            px(buf, w, cx+dx, hy + (1 if abs(dx) >= 4 else 0), OUTLINE)

        # Body (12w x 11h)
        by = base_y - 13
        rect(buf, w, cx-6, by, 12, 11, body)
        px(buf, w, cx-6, by, CLEAR)
        px(buf, w, cx+5, by, CLEAR)

        # Belly (8w x 8h, centered)
        rect(buf, w, cx-4, by+2, 8, 7, belly)

        # Eyes (2x2 white + 1x1 pupil each, big and expressive)
        ey = hy + 2
        rect(buf, w, cx-4, ey, 2, 2, EYE_W)
        rect(buf, w, cx+2, ey, 2, 2, EYE_W)
        px(buf, w, cx-3, ey+1, PUPIL)
        px(buf, w, cx+3, ey+1, PUPIL)
        # Blink on type2
        if anim == 5:
            rect(buf, w, cx-4, ey, 2, 2, body)
            rect(buf, w, cx+2, ey, 2, 2, body)
            px(buf, w, cx-4, ey+1, EYE_W)
            px(buf, w, cx-3, ey+1, EYE_W)
            px(buf, w, cx+2, ey+1, EYE_W)
            px(buf, w, cx+3, ey+1, EYE_W)

        # Beak (3px wide, centered)
        rect(buf, w, cx-1, hy+5, 3, 1, BEAK)
        px(buf, w, cx, hy+6, BEAK)

        # Cheeks
        px(buf, w, cx-5, hy+4, CHEEK)
        px(buf, w, cx+4, hy+4, CHEEK)

        # Wings
        rect(buf, w, cx-7, by+2, 1, 7, body)
        rect(buf, w, cx+6, by+2, 1, 7, body)
        if anim in (1, 3):  # flap
            px(buf, w, cx-8, by+3, body)
            px(buf, w, cx+7, by+3, body)
        if anim in (4, 5):  # type: extend right wing
            rect(buf, w, cx+6, by+4, 2, 3, body)

        # Feet
        fy2 = base_y - 1
        if anim == 1:
            rect(buf, w, cx-4, fy2, 3, 2, FEET)
            rect(buf, w, cx+1, fy2+1, 3, 2, FEET)
        elif anim == 3:
            rect(buf, w, cx-4, fy2+1, 3, 2, FEET)
            rect(buf, w, cx+1, fy2, 3, 2, FEET)
        else:
            rect(buf, w, cx-4, fy2, 3, 2, FEET)
            rect(buf, w, cx+1, fy2, 3, 2, FEET)

    elif facing == 1:  # BACK
        hy = base_y - 20
        rect(buf, w, cx-5, hy, 10, 7, body)
        px(buf, w, cx-5, hy, CLEAR); px(buf, w, cx+4, hy, CLEAR)
        by = base_y - 13
        rect(buf, w, cx-6, by, 12, 11, body)
        # Tail nub
        px(buf, w, cx, base_y-3, body)
        px(buf, w, cx-1, base_y-3, body)
        # Wings
        rect(buf, w, cx-7, by+2, 1, 7, body)
        rect(buf, w, cx+6, by+2, 1, 7, body)
        if anim in (1, 3):
            px(buf, w, cx-8, by+3, body)
            px(buf, w, cx+7, by+3, body)
        # Feet
        rect(buf, w, cx-4, base_y-1, 3, 2, FEET)
        rect(buf, w, cx+1, base_y-1, 3, 2, FEET)

    elif facing == 2:  # SIDE (facing left)
        hy = base_y - 20
        rect(buf, w, cx-3, hy, 8, 7, body)
        px(buf, w, cx-3, hy, CLEAR); px(buf, w, cx+4, hy, CLEAR)
        by = base_y - 13
        rect(buf, w, cx-4, by, 10, 11, body)
        # Belly
        rect(buf, w, cx-4, by+2, 5, 7, belly)
        # Eye
        rect(buf, w, cx-3, hy+2, 2, 2, EYE_W)
        px(buf, w, cx-3, hy+3, PUPIL)
        if anim == 5:
            rect(buf, w, cx-3, hy+2, 2, 2, body)
            px(buf, w, cx-3, hy+3, EYE_W)
            px(buf, w, cx-2, hy+3, EYE_W)
        # Beak
        rect(buf, w, cx-5, hy+4, 2, 1, BEAK)
        px(buf, w, cx-5, hy+5, BEAK)
        # Cheek
        px(buf, w, cx-2, hy+4, CHEEK)
        # Far wing
        rect(buf, w, cx+5, by+2, 1, 7, body)
        if anim in (4, 5):
            rect(buf, w, cx-6, by+5, 2, 3, body)
        # Feet
        if anim == 1:
            rect(buf, w, cx-3, base_y-1, 3, 2, FEET)
            rect(buf, w, cx+1, base_y, 3, 2, FEET)
        elif anim == 3:
            rect(buf, w, cx-3, base_y, 3, 2, FEET)
            rect(buf, w, cx+1, base_y-1, 3, 2, FEET)
        else:
            rect(buf, w, cx-2, base_y-1, 3, 2, FEET)
            rect(buf, w, cx+1, base_y-1, 3, 2, FEET)


# Accessories (positioned relative to frame center, top area)
def acc_hat(buf, w, fx, fy):
    cx, top = fx*FRAME_W+8, fy*FRAME_H+2
    rect(buf, w, cx-4, top+3, 8, 2, HAT_RED)
    rect(buf, w, cx-3, top+2, 6, 1, HAT_RED)
    rect(buf, w, cx-2, top+1, 4, 1, HAT_RED)
    rect(buf, w, cx-1, top, 2, 1, HAT_RED)
    rect(buf, w, cx-5, top+4, 10, 1, HAT_GOLD)

def acc_folder(buf, w, fx, fy):
    ox, oy = fx*FRAME_W+11, fy*FRAME_H+12
    rect(buf, w, ox, oy, 5, 6, FOLDER_Y)
    rect(buf, w, ox, oy, 3, 1, FOLDER_T)

def acc_stopwatch(buf, w, fx, fy):
    ox, oy = fx*FRAME_W+11, fy*FRAME_H+11
    rect(buf, w, ox, oy, 4, 4, WATCH_S)
    rect(buf, w, ox+1, oy+1, 2, 2, WATCH_F)
    px(buf, w, ox+1, oy-1, WATCH_S)

def acc_memblock(buf, w, fx, fy):
    ox, oy = fx*FRAME_W+11, fy*FRAME_H+11
    rect(buf, w, ox, oy, 5, 5, MEM_G)
    rect(buf, w, ox, oy, 5, 1, MEM_D)
    rect(buf, w, ox+1, oy+3, 3, 1, MEM_D)

def acc_envelope(buf, w, fx, fy):
    ox, oy = fx*FRAME_W+11, fy*FRAME_H+13
    rect(buf, w, ox, oy, 5, 4, ENV_C)
    px(buf, w, ox+2, oy+1, ENV_S)  # seal
    rect(buf, w, ox, oy, 5, 1, ENV_S)  # top edge


def gen_sheet(body, belly):
    buf = [CLEAR] * (SHEET_W * SHEET_H)
    for r in range(ROWS):
        for c in range(COLS):
            tux(buf, SHEET_W, c, r, r, c, body, belly)
    return buf

def gen_acc(fn):
    w, h = FRAME_W * COLS, FRAME_H
    buf = [CLEAR] * (w * h)
    for c in range(COLS):
        fn(buf, w, c, 0)
    return buf, w, h

def main():
    d = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'web', 'art')
    os.makedirs(d, exist_ok=True)
    for name, data in [('penguin-base.png', gen_sheet(BODY, BELLY)),
                       ('penguin-guest.png', gen_sheet(G_BODY, G_BELLY))]:
        open(os.path.join(d, name), 'wb').write(make_png(SHEET_W, SHEET_H, data))
    for name, fn in [('acc-hat.png', acc_hat), ('acc-folder.png', acc_folder),
                     ('acc-stopwatch.png', acc_stopwatch), ('acc-memblock.png', acc_memblock),
                     ('acc-envelope.png', acc_envelope)]:
        buf, w, h = gen_acc(fn)
        open(os.path.join(d, name), 'wb').write(make_png(w, h, buf))
    print('Generated sprites in', d)

if __name__ == '__main__':
    main()
