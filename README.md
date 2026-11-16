# The Whale Came for the Moon

make.fun `ai-excited-01` entry.

## The image

A mountain-sized humpback whale breaching diagonally out of a night sea,
straight toward a huge golden moon — with one tiny sailboat below to give
the scale away. The whale's dark back catches a gold rim of moonlight; its
pale belly glows against the dark water. Spray bursts where the tail leaves
the sea, and the moon's reflection shimmers down to the little boat.

One diagonal of motion, one bright focal point, one joke of scale.

## How it is made

`main.ts` draws the whole scene in code — no image assets, no fonts, no
network. A small software renderer (scanline polygon fill, antialiased
discs, radial glows, bezier spine with a width profile for the whale,
5x7 bitmap font for the caption) paints into a 1024x1024 framebuffer,
then a hand-rolled PNG encoder (zlib deflate + CRC32) writes
`/output/entry.png`. Node 22 standard library only, fully deterministic:
same bytes on every run.

## Run

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

Writes `out/entry.png` (PNG, 1024x1024, under 1 MiB).
