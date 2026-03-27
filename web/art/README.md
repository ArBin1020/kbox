# Art Asset Credits

## Penguin Sprites
- `penguin-base.png`, `penguin-guest.png` -- Original pixel art generated
  for kbox. Frame layout (7x3) inspired by tinyclaw/TinyOffice character
  sprite system. MIT licensed.

## Accessory Overlays
- `acc-hat.png`, `acc-folder.png`, `acc-stopwatch.png`, `acc-memblock.png`,
  `acc-envelope.png` -- Original pixel art generated for kbox. MIT licensed.

## Inspiration
- Character animation patterns adapted from:
  - [tinyclaw/TinyOffice](https://github.com/tinyagi/tinyagi) (sprite sheet
    frame layout, animation state machine)
  - [star-office-ui-v2](https://github.com/acsone/star-office-ui-v2) (pixel
    art aesthetic, state-driven character behavior)
- Visual narrative style inspired by [inside the linux kernel](https://turnoff.us/geek/inside-the-linux-kernel/)
  by Daniel Stori

## Generator
Sprites produced by `scripts/gen-penguin-sprites.py` (pure Python, no
external dependencies). Regenerate with:
```
python3 scripts/gen-penguin-sprites.py
```
