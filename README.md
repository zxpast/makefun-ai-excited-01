# He Came for the Moon

A 1024x1024 flat-poster night scene for the make.fun competition
`ai-excited-01`: a mountain-sized humpback whale breaches diagonally out
of a dark sea, arcing up to a huge glowing golden full moon as if it came
to eat it. A tiny sailboat at bottom-right gives the scale away. The
caption reads: "HEY JUDGE - HE CAME FOR THE MOON."

## How it works

`main.ts` draws everything from scratch with no dependencies and no
network: a 1024x1024 RGB framebuffer, scanline polygon fill,
antialiased discs, soft radial glows, a cubic-bezier whale spine with a
width profile, a hand-defined 5x7 bitmap font, and a hand-rolled PNG
encoder (filter-0 scanlines, zlib deflate level 9, CRC32). A fixed-seed
deterministic PRNG makes repeated runs byte-identical.

## Run

```sh
MAKEFUN_OUTPUT_DIR=out node main.ts
```

This writes `out/entry.png` (1024x1024 PNG).
