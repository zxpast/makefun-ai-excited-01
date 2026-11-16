// Whale vs Moon — a flat-poster night scene, 1024x1024.
// Own implementation: RGB framebuffer, scanline polygons, antialiased
// discs, soft radial glows, a cubic-bezier whale spine with a width
// profile, a hand-defined 5x7 bitmap font, and a hand-rolled PNG
// encoder (filter-0 scanlines, zlib deflate level 9, CRC32).
// Deterministic: fixed-seed PRNG, no clock, no Math.random, no network.
import * as fs from "node:fs";
import * as zlib from "node:zlib";

const W = 1024;
const H = 1024;
const fb = new Uint8Array(W * H * 3);

// ---- deterministic PRNG (mulberry32, fixed seed) ----
let rngState = 0x9e3779b9;
function rnd(): number {
  rngState |= 0;
  rngState = (rngState + 0x6d2b79f5) | 0;
  let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function rndRange(a: number, b: number): number {
  return a + (b - a) * rnd();
}

// ---- colour helpers ----
type RGB = [number, number, number];
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
function mix(c1: RGB, c2: RGB, t: number): RGB {
  return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
}
function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// ---- pixel primitives ----
function put(x: number, y: number, c: RGB, alpha: number): void {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 0 || xi >= W || yi < 0 || yi >= H) return;
  const i = (yi * W + xi) * 3;
  const a = clamp(alpha, 0, 1);
  fb[i] = Math.round(fb[i] * (1 - a) + c[0] * a);
  fb[i + 1] = Math.round(fb[i + 1] * (1 - a) + c[1] * a);
  fb[i + 2] = Math.round(fb[i + 2] * (1 - a) + c[2] * a);
}
function fillRect(x0: number, y0: number, x1: number, y1: number, c: RGB): void {
  for (let y = Math.max(0, Math.floor(y0)); y < Math.min(H, Math.ceil(y1)); y++) {
    for (let x = Math.max(0, Math.floor(x0)); x < Math.min(W, Math.ceil(x1)); x++) {
      const i = (y * W + x) * 3;
      fb[i] = c[0]; fb[i + 1] = c[1]; fb[i + 2] = c[2];
    }
  }
}
// Antialiased filled disc.
function disc(cx: number, cy: number, r: number, c: RGB, alpha: number): void {
  if (r <= 0) return;
  const x0 = Math.floor(cx - r - 1);
  const x1 = Math.ceil(cx + r + 1);
  const y0 = Math.floor(cy - r - 1);
  const y1 = Math.ceil(cy + r + 1);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy));
      const cov = clamp(r + 0.5 - d, 0, 1);
      if (cov > 0) put(x, y, c, alpha * cov);
    }
  }
}
// Soft radial glow: alpha falls off quadratically to radius R.
function glow(cx: number, cy: number, R: number, c: RGB, strength: number): void {
  const x0 = Math.max(0, Math.floor(cx - R));
  const x1 = Math.min(W - 1, Math.ceil(cx + R));
  const y0 = Math.max(0, Math.floor(cy - R));
  const y1 = Math.min(H - 1, Math.ceil(cy + R));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy)) / R;
      if (d >= 1) continue;
      const a = strength * (1 - d) * (1 - d);
      put(x, y, c, a);
    }
  }
}
// Scanline polygon fill.
function polygon(pts: Array<[number, number]>, c: RGB, alpha: number): void {
  let minY = H;
  let maxY = 0;
  for (const p of pts) {
    minY = Math.min(minY, Math.floor(p[1]));
    maxY = Math.max(maxY, Math.ceil(p[1]));
  }
  for (let y = Math.max(0, minY); y <= Math.min(H - 1, maxY); y++) {
    const xs: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) {
        const t = (y - a[1]) / (b[1] - a[1]);
        xs.push(a[0] + t * (b[0] - a[0]));
      }
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      for (let x = Math.max(0, Math.ceil(xs[k])); x <= Math.min(W - 1, Math.floor(xs[k + 1])); x++) {
        put(x, y, c, alpha);
      }
    }
  }
}
// Thick line as a chain of discs.
function thickLine(x0: number, y0: number, x1: number, y1: number, r: number, c: RGB, alpha: number): void {
  const len = Math.sqrt((x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0));
  const steps = Math.max(1, Math.ceil(len / Math.max(1, r)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    disc(lerp(x0, x1, t), lerp(y0, y1, t), r, c, alpha);
  }
}

// ---- palette ----
const SKY_TOP: RGB = [8, 14, 46];
const SKY_HOR: RGB = [22, 30, 70];
const SEA_TOP: RGB = [10, 28, 58];
const SEA_BOT: RGB = [5, 15, 34];
const MOON_GOLD: RGB = [247, 201, 72];
const MOON_PALE: RGB = [255, 233, 168];
const MOON_DEEP: RGB = [232, 184, 74];
const WHALE: RGB = [34, 56, 110];
const WHALE_DARK: RGB = [24, 40, 84];
const BELLY: RGB = [220, 230, 242];
const RIM: RGB = [255, 201, 77];
const WHITE: RGB = [255, 255, 255];
const SPRAY: RGB = [235, 244, 255];

// ---- background: sky gradient, then sea ----
for (let y = 0; y < H; y++) {
  let c: RGB;
  if (y < 648) {
    c = mix(SKY_TOP, SKY_HOR, y / 648);
  } else {
    c = mix(SEA_TOP, SEA_BOT, (y - 648) / (H - 648));
  }
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 3;
    fb[i] = c[0]; fb[i + 1] = c[1]; fb[i + 2] = c[2];
  }
}
// Horizon shimmer line.
for (let x = 0; x < W; x++) {
  put(x, 648, [70, 95, 140], 0.35);
  put(x, 649, [50, 75, 120], 0.3);
}

// ---- stars (sky only, keep clear of the moon) ----
const MOON: { x: number; y: number; r: number } = { x: 775, y: 215, r: 148 };
for (let i = 0; i < 260; i++) {
  const sx = rndRange(0, W);
  const sy = rndRange(0, 600);
  const dm = Math.sqrt((sx - MOON.x) * (sx - MOON.x) + (sy - MOON.y) * (sy - MOON.y));
  if (dm < MOON.r + 28) continue;
  const b = rndRange(0.35, 1);
  const s = rnd() < 0.12 ? 2 : 1;
  disc(sx, sy, s === 2 ? 1.8 : 1.1, [255, 250, 230], b);
  if (rnd() < 0.08) {
    // tiny cross sparkle
    put(sx + 3, sy, WHITE, b * 0.6);
    put(sx - 3, sy, WHITE, b * 0.6);
    put(sx, sy + 3, WHITE, b * 0.6);
    put(sx, sy - 3, WHITE, b * 0.6);
  }
}

// ---- moon: halo, disc, shading, craters ----
glow(MOON.x, MOON.y, 330, MOON_GOLD, 0.34);
glow(MOON.x, MOON.y, 215, MOON_PALE, 0.5);
disc(MOON.x, MOON.y, MOON.r, MOON_GOLD, 1);
disc(MOON.x - 14, MOON.y - 16, MOON.r - 16, MOON_PALE, 0.85);
disc(MOON.x + 34, MOON.y + 42, MOON.r - 52, MOON_GOLD, 0.35);
const craters: Array<[number, number, number]> = [
  [725, 170, 17], [800, 150, 12], [835, 235, 20], [745, 265, 13],
  [795, 285, 9], [860, 180, 10], [700, 225, 8],
];
for (const [cx, cy, cr] of craters) disc(cx, cy, cr, MOON_DEEP, 0.5);
// Bright rim on the moon's lower-left edge (facing the whale).
for (let a = Math.PI * 0.55; a <= Math.PI * 1.05; a += 0.02) {
  disc(MOON.x + Math.cos(a) * (MOON.r - 2), MOON.y + Math.sin(a) * (MOON.r - 2), 3, MOON_PALE, 0.9);
}

// ---- moon reflection: shimmering gold column on the water ----
glow(775, 820, 190, MOON_GOLD, 0.16);
for (let i = 0; i < 150; i++) {
  const ry = rndRange(660, 1000);
  const depth = (ry - 660) / 340; // 0 at horizon, 1 at bottom
  const halfW = lerp(28, 95, depth) * rndRange(0.5, 1.3);
  const cx = 775 + rndRange(-halfW, halfW);
  const len = rndRange(8, 46) * (0.6 + depth);
  const a = lerp(0.9, 0.28, depth) * rndRange(0.5, 1);
  thickLine(cx - len / 2, ry, cx + len / 2, ry, rndRange(1.2, 2.6), MOON_GOLD, a);
}
// A few dark sea strokes for texture.
for (let i = 0; i < 60; i++) {
  const ry = rndRange(670, 990);
  const cx = rndRange(0, W);
  const len = rndRange(20, 80);
  thickLine(cx, ry, cx + len, ry, 1.4, [4, 12, 28], rndRange(0.2, 0.45));
}

// ---- whale: cubic-bezier spine + width profile ----
// Spine: tail bottom-left -> head top-right, head overlapping moon's lower edge.
const P0: [number, number] = [95, 905];
const P1: [number, number] = [215, 755];
const P2: [number, number] = [440, 555];
const P3: [number, number] = [705, 330];
function bezier(t: number): [number, number] {
  const u = 1 - t;
  const x = u * u * u * P0[0] + 3 * u * u * t * P1[0] + 3 * u * t * t * P2[0] + t * t * t * P3[0];
  const y = u * u * u * P0[1] + 3 * u * u * t * P1[1] + 3 * u * t * t * P2[1] + t * t * t * P3[1];
  return [x, y];
}
function bezierTan(t: number): [number, number] {
  const u = 1 - t;
  const x = 3 * u * u * (P1[0] - P0[0]) + 6 * u * t * (P2[0] - P1[0]) + 3 * t * t * (P3[0] - P2[0]);
  const y = 3 * u * u * (P1[1] - P0[1]) + 6 * u * t * (P2[1] - P1[1]) + 3 * t * t * (P3[1] - P2[1]);
  const len = Math.sqrt(x * x + y * y) || 1;
  return [x / len, y / len];
}
// Width knots (t -> full width in px).
const WIDTH_KNOTS: Array<[number, number]> = [
  [0, 16], [0.12, 52], [0.3, 108], [0.5, 146], [0.68, 138], [0.85, 116], [1, 82],
];
function widthAt(t: number): number {
  for (let i = 0; i + 1 < WIDTH_KNOTS.length; i++) {
    const a = WIDTH_KNOTS[i];
    const b = WIDTH_KNOTS[i + 1];
    if (t >= a[0] && t <= b[0]) {
      const f = (t - a[0]) / (b[0] - a[0]);
      const s = f * f * (3 - 2 * f); // smoothstep
      return lerp(a[1], b[1], s);
    }
  }
  return WIDTH_KNOTS[WIDTH_KNOTS.length - 1][1];
}
// Tail fluke first (behind the body): two lobes fanning from the tail tip.
polygon([[108, 888], [58, 832], [16, 806], [72, 884]], WHALE_DARK, 1);
polygon([[108, 892], [62, 948], [24, 966], [80, 908]], WHALE_DARK, 1);
disc(16, 806, 7, WHALE_DARK, 1);
disc(24, 966, 7, WHALE_DARK, 1);
// Body: overlapping discs along the spine (dark indigo back).
for (let t = 0; t <= 1.0001; t += 0.002) {
  const [x, y] = bezier(t);
  disc(x, y, widthAt(t) / 2, WHALE, 1);
}
// Darker top shading along the spine centre (depth on the back).
for (let t = 0.05; t <= 0.98; t += 0.004) {
  const [x, y] = bezier(t);
  const [tx, ty] = bezierTan(t);
  const nx = -ty;
  const ny = tx;
  disc(x - nx * widthAt(t) * 0.18, y - ny * widthAt(t) * 0.18, widthAt(t) * 0.22, WHALE_DARK, 0.55);
}
// Pale belly: discs offset toward the south-east normal (belly side).
for (let t = 0.06; t <= 0.99; t += 0.003) {
  const [x, y] = bezier(t);
  const [tx, ty] = bezierTan(t);
  const nx = -ty;
  const ny = tx;
  const w = widthAt(t);
  disc(x + nx * w * 0.32, y + ny * w * 0.32, w * 0.30, BELLY, 0.96);
}
// Gold rim of moonlight along the moon-facing (north-west) edge.
for (let t = 0.02; t <= 1.0; t += 0.002) {
  const [x, y] = bezier(t);
  const [tx, ty] = bezierTan(t);
  const nx = -ty;
  const ny = tx;
  const w = widthAt(t);
  disc(x - nx * w * 0.47, y - ny * w * 0.47, 3.2, RIM, 0.95);
}
// Pectoral fin: a dark fin sweeping down from the mid-body.
{
  const [bx, by] = bezier(0.58);
  const [tx, ty] = bezierTan(0.58);
  const nx = -ty;
  const ny = tx;
  const w = widthAt(0.58);
  const baseX = bx + nx * w * 0.30;
  const baseY = by + ny * w * 0.30;
  polygon(
    [[baseX - tx * 34, baseY - ty * 34], [baseX + tx * 30, baseY + ty * 30],
     [baseX + tx * 78 + nx * 92, baseY + ty * 78 + ny * 92],
     [baseX + tx * 30 + nx * 108, baseY + ty * 30 + ny * 108]],
    WHALE_DARK, 1,
  );
  disc(baseX + tx * 78 + nx * 92, baseY + ty * 78 + ny * 92, 6, WHALE_DARK, 1);
}
// Head: the body discs already round it off; add a pale jaw patch so the
// head reads against the moon, and keep the gold rim crossing in front.
{
  const [hx, hy] = bezier(0.985);
  disc(hx + 14, hy + 22, 26, BELLY, 0.9);
  disc(hx, hy, 10, WHALE, 0.9);
}

// ---- spray where the tail leaves the water ----
for (let i = 0; i < 110; i++) {
  const a = rndRange(-Math.PI * 0.95, -Math.PI * 0.05);
  const r = rndRange(6, 150) * (rnd() < 0.5 ? 1 : 0.55);
  const sx = 100 + Math.cos(a) * r * 1.15;
  const sy = 892 + Math.sin(a) * r * 0.75;
  disc(sx, sy, rndRange(1.5, 5.5), SPRAY, rndRange(0.5, 0.95));
}
// A few arcing spray streaks.
for (let i = 0; i < 14; i++) {
  const a0 = rndRange(Math.PI * 1.05, Math.PI * 1.55);
  const r0 = rndRange(40, 120);
  const x0 = 100 + Math.cos(a0) * r0;
  const y0 = 892 + Math.sin(a0) * r0 * 0.7;
  thickLine(x0, y0, x0 + rndRange(-30, 30), y0 - rndRange(14, 42), 2.2, SPRAY, 0.8);
}
// White splash ring on the water around the tail.
for (let a = 0; a < Math.PI * 2; a += 0.05) {
  const ex = 105 + Math.cos(a) * 118;
  const ey = 898 + Math.sin(a) * 20;
  if (ey > 660) disc(ex, ey, 2.6, WHITE, 0.75);
}

// ---- tiny sailboat, bottom-right (the scale joke) ----
{
  const bx = 845;
  const by = 818; // waterline
  // Mast + sails.
  thickLine(bx, by, bx, 758, 2.2, [20, 26, 44], 1);
  polygon([[bx + 3, 762], [bx + 3, 812], [bx + 52, 812]], [242, 245, 250], 1);
  polygon([[bx - 3, 776], [bx - 3, 812], [bx - 30, 812]], [201, 214, 232], 1);
  disc(bx, 756, 3.5, MOON_GOLD, 1);
  // Hull.
  polygon([[bx - 46, by], [bx + 48, by], [bx + 34, by + 22], [bx - 32, by + 22]], [14, 21, 38], 1);
  thickLine(bx - 46, by, bx + 48, by, 1.6, RIM, 0.9);
  // Little reflection under the hull.
  thickLine(bx - 30, by + 30, bx + 28, by + 30, 1.6, [120, 140, 175], 0.5);
  thickLine(bx - 18, by + 40, bx + 16, by + 40, 1.4, [120, 140, 175], 0.35);
}

// ---- caption: hand-defined 5x7 bitmap font, scale 3 ----
// Each glyph: 7 rows of 5 chars, "#" = on.
const FONT: Record<string, string[]> = {
  " ": [".....", ".....", ".....", ".....", ".....", ".....", "....."],
  "-": [".....", ".....", ".....", "#####", ".....", ".....", "....."],
  ".": [".....", ".....", ".....", ".....", ".....", ".##..", ".##.."],
  "A": [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  "C": [".####", "#....", "#....", "#....", "#....", "#....", ".####"],
  "D": ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
  "E": ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
  "F": ["#####", "#....", "#....", "####.", "#....", "#....", "#...."],
  "G": [".####", "#....", "#....", "#.###", "#...#", "#...#", ".###."],
  "H": ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  "J": ["..###", "...#.", "...#.", "...#.", "...#.", "#..#.", ".##.."],
  "M": ["#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#"],
  "N": ["#...#", "##..#", "#.#.#", "#..##", "#...#", "#...#", "#...#"],
  "O": [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  "R": ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
  "T": ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
  "U": ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  "Y": ["#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."],
};
function drawText(text: string, x0: number, y0: number, scale: number, c: RGB): void {
  let cx = x0;
  for (const ch of text) {
    const g = FONT[ch] ?? FONT[" "];
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 5; col++) {
        if (g[row][col] === "#") {
          fillRect(cx + col * scale, y0 + row * scale, cx + (col + 1) * scale, y0 + (row + 1) * scale, c);
        }
      }
    }
    cx += 6 * scale;
  }
}
const CAPTION = "HEY JUDGE - HE CAME FOR THE MOON.";
drawText(CAPTION, 34, 38, 3, [10, 16, 40]);
drawText(CAPTION, 32, 36, 3, MOON_PALE);

// ---- PNG encoder: filter-0 scanlines, zlib level 9, CRC32 ----
const CRC_TABLE: Uint32Array = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}
function encodePng(): Buffer {
  const raw = Buffer.alloc(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 3)] = 0;
    raw.set(fb.subarray(y * W * 3, (y + 1) * W * 3), y * (1 + W * 3) + 1);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outDir + "/entry.png", encodePng());
