// ai-excited-01 entry: "The Whale Came for the Moon"
// A lone humpback whale, mountain-sized, breaching diagonally out of a night
// sea straight toward a huge golden moon — a tiny sailboat below gives the
// scale away. Drawn entirely in code: flat poster style, high contrast,
// one diagonal of motion, one bright focal point. No faces, no hands, no
// photographic texture — nothing that can smear or break at 300 px.
// Node 22, standard library only (node:fs, node:zlib). Deterministic:
// fixed-seed PRNG, no clock, no network. Both runs write identical bytes.

import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const W = 1024;
const H = 1024;
const OUT_DIR = process.env.MAKEFUN_OUTPUT_DIR || "/output";

// ---------- deterministic PRNG (mulberry32) ----------
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261116);

// ---------- framebuffer (float RGB 0..255) ----------
const fb = new Float32Array(W * H * 3);

type RGB = [number, number, number];
type Pt = [number, number];

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
function mix(c1: RGB, c2: RGB, t: number): RGB {
  return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
}

// source-over blend at integer pixel
function blend(x: number, y: number, c: RGB, a: number): void {
  if (x < 0 || y < 0 || x >= W || y >= H || a <= 0) return;
  const i = (y * W + x) * 3;
  const ia = 1 - a;
  fb[i] = c[0] * a + fb[i] * ia;
  fb[i + 1] = c[1] * a + fb[i + 1] * ia;
  fb[i + 2] = c[2] * a + fb[i + 2] * ia;
}

// vertical gradient fill of a rectangle
function vgrad(x0: number, y0: number, x1: number, y1: number, stops: [number, RGB][]): void {
  for (let y = y0; y < y1; y++) {
    const t = (y - y0) / Math.max(1, y1 - y0 - 1);
    let c: RGB = stops[stops.length - 1][1];
    for (let s = 0; s + 1 < stops.length; s++) {
      if (t >= stops[s][0] && t <= stops[s + 1][0]) {
        const u = (t - stops[s][0]) / (stops[s + 1][0] - stops[s][0]);
        c = mix(stops[s][1], stops[s + 1][1], u);
        break;
      }
    }
    for (let x = x0; x < x1; x++) {
      const i = (y * W + x) * 3;
      fb[i] = c[0];
      fb[i + 1] = c[1];
      fb[i + 2] = c[2];
    }
  }
}

// antialiased filled circle
function disc(cx: number, cy: number, r: number, c: RGB, a: number): void {
  const x0 = Math.max(0, Math.floor(cx - r - 1));
  const x1 = Math.min(W - 1, Math.ceil(cx + r + 1));
  const y0 = Math.max(0, Math.floor(cy - r - 1));
  const y1 = Math.min(H - 1, Math.ceil(cy + r + 1));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      const cov = clamp(r - d + 0.5, 0, 1);
      if (cov > 0) blend(x, y, c, a * cov);
    }
  }
}

// soft radial glow
function glow(cx: number, cy: number, r: number, c: RGB, peak: number): void {
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(W - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(H - 1, Math.ceil(cy + r));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / r;
      if (d < 1) {
        const a = peak * (1 - d) * (1 - d);
        blend(x, y, c, a);
      }
    }
  }
}

// scanline polygon fill
function fillPoly(pts: Pt[], c: RGB, a: number): void {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    minY = Math.min(minY, p[1]);
    maxY = Math.max(maxY, p[1]);
  }
  const y0 = Math.max(0, Math.floor(minY));
  const y1 = Math.min(H - 1, Math.ceil(maxY));
  for (let y = y0; y <= y1; y++) {
    const yc = y + 0.5;
    const xs: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const p1 = pts[i];
      const p2 = pts[(i + 1) % pts.length];
      if ((p1[1] <= yc && p2[1] > yc) || (p2[1] <= yc && p1[1] > yc)) {
        const t = (yc - p1[1]) / (p2[1] - p1[1]);
        xs.push(p1[0] + t * (p2[0] - p1[0]));
      }
    }
    xs.sort((u, v) => u - v);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(0, Math.ceil(xs[k] - 0.5));
      const xb = Math.min(W - 1, Math.floor(xs[k + 1] - 0.5));
      for (let x = xa; x <= xb; x++) blend(x, y, c, a);
    }
  }
}

// stroke a polyline by stamping discs along it
function stroke(pts: Pt[], width: number, c: RGB, a: number): void {
  for (let i = 0; i + 1 < pts.length; i++) {
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const d = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const steps = Math.max(1, Math.ceil(d / 0.5));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      disc(p1[0] + (p2[0] - p1[0]) * t, p1[1] + (p2[1] - p1[1]) * t, width / 2, c, a);
    }
  }
}

function cubic(p0: Pt, p1: Pt, p2: Pt, p3: Pt, n: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push([
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ]);
  }
  return out;
}

function quad(p0: Pt, pc: Pt, p1: Pt, n: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push([
      u * u * p0[0] + 2 * u * t * pc[0] + t * t * p1[0],
      u * u * p0[1] + 2 * u * t * pc[1] + t * t * p1[1],
    ]);
  }
  return out;
}

function fillRect(x: number, y: number, w: number, h: number, c: RGB, a: number): void {
  for (let yy = Math.max(0, Math.floor(y)); yy < Math.min(H, y + h); yy++) {
    for (let xx = Math.max(0, Math.floor(x)); xx < Math.min(W, x + w); xx++) {
      blend(xx, yy, c, a);
    }
  }
}

// ---------- 5x7 bitmap font (letters used by the caption) ----------
const FONT: Record<string, string[]> = {
  H: ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  E: ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
  Y: ["#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."],
  J: ["..###", "...#.", "...#.", "...#.", "...#.", "#..#.", ".##.."],
  U: ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  D: ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
  G: [".####", "#....", "#....", "#.###", "#...#", "#...#", ".###."],
  C: [".####", "#....", "#....", "#....", "#....", "#....", ".####"],
  A: [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  M: ["#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#"],
  F: ["#####", "#....", "#....", "####.", "#....", "#....", "#...."],
  O: [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  R: ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
  T: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
  N: ["#...#", "##..#", "#.#.#", "#..##", "#...#", "#...#", "#...#"],
  "-": [".....", ".....", ".....", "#####", ".....", ".....", "....."],
  " ": [".....", ".....", ".....", ".....", ".....", ".....", "....."],
};

function drawText(s: string, x: number, y: number, scale: number, c: RGB, a: number): void {
  let cx = x;
  for (const ch of s) {
    const g = FONT[ch];
    if (g) {
      for (let r = 0; r < 7; r++) {
        for (let col = 0; col < 5; col++) {
          if (g[r][col] === "#") {
            fillRect(cx + col * scale, y + r * scale, scale, scale, c, a);
          }
        }
      }
    }
    cx += 6 * scale;
  }
}

// ---------- palette ----------
const SKY_TOP: RGB = [5, 9, 20];
const SKY_MID: RGB = [13, 27, 61];
const SKY_HOR: RGB = [29, 58, 107];
const MOON_CORE: RGB = [255, 246, 207];
const MOON_EDGE: RGB = [242, 193, 78];
const MOON_GLOW: RGB = [255, 217, 138];
const WHALE_BACK: RGB = [22, 34, 77];
const WHALE_BELLY: RGB = [207, 230, 247];
const RIM: RGB = [255, 217, 138];
const SEA_TOP: RGB = [18, 58, 99];
const SEA_BOT: RGB = [5, 15, 34];
const FOAM: RGB = [235, 245, 255];
const SPRAY: RGB = [190, 225, 255];

// ---------- 1. night sky ----------
vgrad(0, 0, W, H, [
  [0, SKY_TOP],
  [0.55, SKY_MID],
  [0.85, SKY_HOR],
  [1, [10, 26, 51]],
]);

// faint nebula glows for depth
glow(200, 150, 230, [42, 30, 94], 0.16);
glow(900, 520, 270, [14, 58, 74], 0.14);
glow(450, 700, 210, [26, 42, 94], 0.1);

// stars
for (let i = 0; i < 240; i++) {
  const x = rand() * W;
  const y = rand() * 800;
  const r = 0.6 + rand() * 1.3;
  const a = 0.25 + rand() * 0.75;
  const warm = rand();
  const c: RGB = warm < 0.2 ? [255, 233, 176] : warm < 0.35 ? [188, 216, 255] : [255, 255, 255];
  disc(x, y, r, c, a);
}
// a few sparkles
for (let i = 0; i < 10; i++) {
  const x = rand() * W;
  const y = rand() * 700;
  const len = 5 + rand() * 7;
  stroke(
    [
      [x - len, y],
      [x + len, y],
    ],
    1.4,
    [255, 255, 255],
    0.8,
  );
  stroke(
    [
      [x, y - len],
      [x, y + len],
    ],
    1.4,
    [255, 255, 255],
    0.8,
  );
}

// ---------- 2. the moon ----------
const MOON: Pt = [775, 235];
glow(MOON[0], MOON[1], 300, MOON_GLOW, 0.3);
// moon disc with a radial gradient (bright upper-left, deeper gold at the rim)
for (let y = Math.floor(MOON[1] - 142); y <= Math.ceil(MOON[1] + 142); y++) {
  for (let x = Math.floor(MOON[0] - 142); x <= Math.ceil(MOON[0] + 142); x++) {
    const d = Math.hypot(x + 0.5 - MOON[0], y + 0.5 - MOON[1]);
    if (d <= 140) {
      const t = clamp(d / 140, 0, 1);
      const c = mix(MOON_CORE, MOON_EDGE, t * t);
      const cov = clamp(140 - d + 0.5, 0, 1);
      blend(x, y, c, cov);
    }
  }
}
// craters
const craters: [number, number, number][] = [
  [720, 190, 18],
  [800, 280, 22],
  [830, 200, 12],
  [745, 285, 14],
  [790, 160, 9],
  [700, 245, 10],
  [835, 255, 8],
  [765, 235, 7],
  [715, 155, 6],
];
for (const [cx, cy, r] of craters) {
  disc(cx, cy, r, [223, 168, 62], 0.28);
}

// ---------- 3. the whale ----------
const MOON_PT: Pt = [775, 235];
const spine = cubic([150, 868], [300, 792], [530, 555], [762, 322], 72);
const prof: [number, number][] = [
  [0, 30],
  [0.08, 55],
  [0.18, 95],
  [0.3, 135],
  [0.45, 182],
  [0.6, 174],
  [0.72, 150],
  [0.85, 112],
  [0.95, 78],
  [1, 58],
];
function widthAt(t: number): number {
  for (let i = 0; i + 1 < prof.length; i++) {
    const [t0, w0] = prof[i];
    const [t1, w1] = prof[i + 1];
    if (t >= t0 && t <= t1) {
      const u = (t - t0) / (t1 - t0);
      const s = u * u * (3 - 2 * u);
      return w0 + (w1 - w0) * s;
    }
  }
  return prof[prof.length - 1][1];
}
// spine samples with tangents and the two side directions
const N = 72;
const centers: Pt[] = spine;
const backPts: Pt[] = [];
const bellyPts: Pt[] = [];
for (let i = 0; i <= N; i++) {
  const t = i / N;
  const p = centers[i];
  const q = centers[Math.min(N, i + 1)];
  const r = centers[Math.max(0, i - 1)];
  let tx = q[0] - r[0];
  let ty = q[1] - r[1];
  const tl = Math.hypot(tx, ty) || 1;
  tx /= tl;
  ty /= tl;
  // two normals; the back side is the one facing the moon
  const n1: Pt = [-ty, tx];
  const n2: Pt = [ty, -tx];
  const d1 = n1[0] * (MOON_PT[0] - p[0]) + n1[1] * (MOON_PT[1] - p[1]);
  const back = d1 > 0 ? n1 : n2;
  const belly: Pt = [-back[0], -back[1]];
  const w = widthAt(t) / 2;
  backPts.push([p[0] + back[0] * w, p[1] + back[1] * w]);
  bellyPts.push([p[0] + belly[0] * w, p[1] + belly[1] * w]);
}
// head cap: arc around the snout through the tip direction
const head = centers[N];
const headTan: Pt = (() => {
  const q = centers[N];
  const r = centers[N - 1];
  const l = Math.hypot(q[0] - r[0], q[1] - r[1]) || 1;
  return [(q[0] - r[0]) / l, (q[1] - r[1]) / l];
})();
const capR = widthAt(1) / 2;
const aL = Math.atan2(backPts[N][1] - head[1], backPts[N][0] - head[0]);
const aR = Math.atan2(bellyPts[N][1] - head[1], bellyPts[N][0] - head[0]);
const aTip = Math.atan2(headTan[1], headTan[0]);
// walk the short way from aL to aR through aTip
function angDiff(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
const capPts: Pt[] = [];
const total = angDiff(aL, aR);
const steps = 14;
for (let i = 0; i <= steps; i++) {
  const a = aL + (total * i) / steps;
  capPts.push([head[0] + Math.cos(a) * capR, head[1] + Math.sin(a) * capR]);
}
// tail flukes first (they sit behind the body)
const S = centers[0];
const tan0: Pt = (() => {
  const q = centers[1];
  const l = Math.hypot(q[0] - S[0], q[1] - S[1]) || 1;
  return [(q[0] - S[0]) / l, (q[1] - S[1]) / l];
})();
const perpUp: Pt = [-tan0[1], tan0[0]]; // points away from the moon side here
const perpDown: Pt = [tan0[1], -tan0[0]];
function fluke(tip: Pt, perp: Pt): Pt[] {
  const b1: Pt = [S[0] + tan0[0] * 14, S[1] + tan0[1] * 14];
  const b2: Pt = [S[0] - tan0[0] * 14, S[1] - tan0[1] * 14];
  const c1: Pt = [S[0] + perp[0] * 95 + tan0[0] * 70, S[1] + perp[1] * 95 + tan0[1] * 70];
  const c2: Pt = [S[0] + perp[0] * 75 - tan0[0] * 15, S[1] + perp[1] * 75 - tan0[1] * 15];
  return [b1, ...quad(b1, c1, tip, 12).slice(1), ...quad(tip, c2, b2, 12).slice(1)];
}
const tipUp: Pt = [S[0] + perpUp[0] * 135 + tan0[0] * 55, S[1] + perpUp[1] * 135 + tan0[1] * 55];
const tipDown: Pt = [S[0] + perpDown[0] * 125 + tan0[0] * 45, S[1] + perpDown[1] * 125 + tan0[1] * 45];
fillPoly(fluke(tipUp, perpUp), WHALE_BACK, 1);
fillPoly(fluke(tipDown, perpDown), WHALE_BACK, 1);
// body
const bodyPoly: Pt[] = [...backPts, ...capPts, ...bellyPts.slice().reverse()];
fillPoly(bodyPoly, WHALE_BACK, 1);
// pectoral fin (belly side, mid-body)
const midI = Math.floor(N * 0.55);
const midC = centers[midI];
const midBelly: Pt = [
  bellyPts[midI][0] - midC[0],
  bellyPts[midI][1] - midC[1],
];
const midBellyN: Pt = (() => {
  const l = Math.hypot(midBelly[0], midBelly[1]) || 1;
  return [midBelly[0] / l, midBelly[1] / l];
})();
const finBase: Pt = [midC[0] + midBellyN[0] * widthAt(0.55) * 0.3, midC[1] + midBellyN[1] * widthAt(0.55) * 0.3];
const finTip: Pt = [finBase[0] + midBellyN[0] * 100 - 25, finBase[1] + midBellyN[1] * 100 + 15];
const finSide: Pt = [midBellyN[1], -midBellyN[0]];
const finPoly: Pt[] = [
  [finBase[0] + finSide[0] * 22, finBase[1] + finSide[1] * 22],
  ...quad(
    [finBase[0] + finSide[0] * 22, finBase[1] + finSide[1] * 22],
    [finBase[0] + midBellyN[0] * 55 + finSide[0] * 18, finBase[1] + midBellyN[1] * 55 + finSide[1] * 18],
    finTip,
    10,
  ).slice(1),
  ...quad(
    finTip,
    [finBase[0] + midBellyN[0] * 55 - finSide[0] * 18, finBase[1] + midBellyN[1] * 55 - finSide[1] * 18],
    [finBase[0] - finSide[0] * 22, finBase[1] - finSide[1] * 22],
    10,
  ).slice(1),
];
fillPoly(finPoly, WHALE_BACK, 1);
// belly band (pale underside)
const bellyBand: Pt[] = [];
for (let i = Math.floor(N * 0.12); i <= Math.floor(N * 0.98); i++) {
  const t = i / N;
  const p = centers[i];
  const dir: Pt = [bellyPts[i][0] - p[0], bellyPts[i][1] - p[1]];
  const l = Math.hypot(dir[0], dir[1]) || 1;
  bellyBand.push([p[0] + (dir[0] / l) * widthAt(t) * 0.46, p[1] + (dir[1] / l) * widthAt(t) * 0.46]);
}
for (let i = Math.floor(N * 0.98); i >= Math.floor(N * 0.12); i--) {
  const t = i / N;
  const p = centers[i];
  const dir: Pt = [bellyPts[i][0] - p[0], bellyPts[i][1] - p[1]];
  const l = Math.hypot(dir[0], dir[1]) || 1;
  bellyBand.push([p[0] + (dir[0] / l) * widthAt(t) * 0.06, p[1] + (dir[1] / l) * widthAt(t) * 0.06]);
}
fillPoly(bellyBand, WHALE_BELLY, 0.95);
// rim light along the back edge (moon side)
stroke(backPts.slice(2), 15, RIM, 0.16);
stroke(backPts.slice(2), 6, RIM, 0.9);
// soft edge on the belly side
stroke(bellyPts.slice(2), 2.5, WHALE_BELLY, 0.35);
// eye
const eyeI = Math.floor(N * 0.93);
const eyeC = centers[eyeI];
const eyeDir: Pt = [backPts[eyeI][0] - eyeC[0], backPts[eyeI][1] - eyeC[1]];
const eyeL = Math.hypot(eyeDir[0], eyeDir[1]) || 1;
const eye: Pt = [eyeC[0] + (eyeDir[0] / eyeL) * widthAt(0.93) * 0.2, eyeC[1] + (eyeDir[1] / eyeL) * widthAt(0.93) * 0.2];
disc(eye[0], eye[1], 8, [6, 16, 31], 1);
disc(eye[0] - 2.5, eye[1] - 2.5, 2.2, [255, 255, 255], 0.95);
// mouth line along the lower head
const mouth = quad(
  [centers[Math.floor(N * 0.99)][0] + (bellyPts[Math.floor(N * 0.99)][0] - centers[Math.floor(N * 0.99)][0]) * 0.3,
   centers[Math.floor(N * 0.99)][1] + (bellyPts[Math.floor(N * 0.99)][1] - centers[Math.floor(N * 0.99)][1]) * 0.3],
  [centers[Math.floor(N * 0.9)][0] + (bellyPts[Math.floor(N * 0.9)][0] - centers[Math.floor(N * 0.9)][0]) * 0.55,
   centers[Math.floor(N * 0.9)][1] + (bellyPts[Math.floor(N * 0.9)][1] - centers[Math.floor(N * 0.9)][1]) * 0.55],
  [centers[Math.floor(N * 0.78)][0] + (bellyPts[Math.floor(N * 0.78)][0] - centers[Math.floor(N * 0.78)][0]) * 0.5,
   centers[Math.floor(N * 0.78)][1] + (bellyPts[Math.floor(N * 0.78)][1] - centers[Math.floor(N * 0.78)][1]) * 0.5],
  24,
);
stroke(mouth, 4, [8, 22, 45], 0.85);
// throat grooves on the belly near the head
for (let k = 0; k < 3; k++) {
  const ti = Math.floor(N * (0.8 + k * 0.05));
  const p = centers[ti];
  const dir: Pt = [bellyPts[ti][0] - p[0], bellyPts[ti][1] - p[1]];
  const l = Math.hypot(dir[0], dir[1]) || 1;
  const g = quad(
    [p[0] + (dir[0] / l) * widthAt(ti / N) * 0.08, p[1] + (dir[1] / l) * widthAt(ti / N) * 0.08],
    [p[0] + (dir[0] / l) * widthAt(ti / N) * 0.3 - 12, p[1] + (dir[1] / l) * widthAt(ti / N) * 0.3 + 8],
    [p[0] + (dir[0] / l) * widthAt(ti / N) * 0.44, p[1] + (dir[1] / l) * widthAt(ti / N) * 0.44],
    12,
  );
  stroke(g, 3, [127, 178, 217], 0.5);
}
// blowhole spray from the top of the head
const blowBase: Pt = [
  centers[Math.floor(N * 0.985)][0] + (backPts[Math.floor(N * 0.985)][0] - centers[Math.floor(N * 0.985)][0]) * 0.9,
  centers[Math.floor(N * 0.985)][1] + (backPts[Math.floor(N * 0.985)][1] - centers[Math.floor(N * 0.985)][1]) * 0.9,
];
for (let k = 0; k < 7; k++) {
  const ang = -Math.PI / 2 + (k - 3) * 0.22;
  const len = 34 + rand() * 36;
  stroke(
    [blowBase, [blowBase[0] + Math.cos(ang) * len, blowBase[1] + Math.sin(ang) * len]],
    3,
    [235, 245, 255],
    0.8,
  );
  disc(blowBase[0] + Math.cos(ang) * (len + 6), blowBase[1] + Math.sin(ang) * (len + 6), 2.5, SPRAY, 0.9);
}

// ---------- 4. the sea (covers the tail below the wave line) ----------
function waveY(x: number): number {
  return 862 + 5 * Math.sin(x * 0.021) + 3 * Math.sin(x * 0.047 + 1.7);
}
const seaBands: [number, number, RGB][] = [
  [860, 890, [18, 58, 99]],
  [890, 920, [15, 50, 86]],
  [920, 950, [12, 42, 73]],
  [950, 980, [9, 34, 60]],
  [980, 1010, [7, 26, 48]],
  [1010, 1024, [5, 15, 34]],
];
for (const [ya, yb, c] of seaBands) {
  const pts: Pt[] = [];
  for (let x = 0; x <= W; x += 8) pts.push([x, ya + (waveY(x) - 862)]);
  for (let x = W; x >= 0; x -= 8) pts.push([x, yb + (waveY(x) - 862)]);
  fillPoly(pts, c, 1);
}
// wave lines
for (let k = 0; k < 4; k++) {
  const yBase = 905 + k * 32;
  const pts: Pt[] = [];
  for (let x = 0; x <= W; x += 8) {
    pts.push([x, yBase + 4 * Math.sin(x * 0.03 + k * 1.9)]);
  }
  stroke(pts, 3, [47, 106, 168], 0.3);
}
// moon reflection: a shimmering gold column under the moon
for (let y = 880; y < 1010; y += 13) {
  const t = (y - 880) / 130;
  const wdt = 90 * (1 - t) + 25;
  const jx = (rand() - 0.5) * 26;
  fillRect(MOON[0] - wdt / 2 + jx, y, wdt, 5, MOON_EDGE, 0.6 * (1 - t) + 0.1);
}
// breach foam: arcs + droplets where the tail leaves the water
const breach: Pt = [195, 860];
for (const [rr, wd, al] of [
  [42, 5, 0.75],
  [66, 4, 0.5],
  [92, 3, 0.3],
] as [number, number, number][]) {
  const arc: Pt[] = [];
  for (let a = Math.PI * 1.08; a <= Math.PI * 1.92; a += 0.08) {
    arc.push([breach[0] + Math.cos(a) * rr, breach[1] + Math.sin(a) * rr * 0.55]);
  }
  stroke(arc, wd, FOAM, al);
}
for (let i = 0; i < 55; i++) {
  const ang = Math.PI + rand() * Math.PI; // upper fan
  const rr = 18 + rand() * 125;
  const x = breach[0] + Math.cos(ang) * rr;
  const y = breach[1] + Math.sin(ang) * rr * 0.6;
  disc(x, y, 1 + rand() * 2.8, rand() < 0.5 ? FOAM : SPRAY, 0.55 + rand() * 0.4);
}

// ---------- 5. the tiny sailboat (the scale joke) ----------
const boatX = 830;
const boatY = 912;
fillPoly(
  [
    [boatX - 24, boatY],
    [boatX + 28, boatY],
    [boatX + 20, boatY + 13],
    [boatX - 16, boatY + 13],
  ],
  [10, 22, 38],
  1,
);
stroke(
  [
    [boatX + 2, boatY],
    [boatX + 2, boatY - 40],
  ],
  3,
  [10, 22, 38],
  1,
);
fillPoly(
  [
    [boatX + 2, boatY - 38],
    [boatX + 2, boatY - 2],
    [boatX + 32, boatY - 2],
  ],
  [238, 244, 251],
  0.95,
);
disc(boatX - 6, boatY - 6, 2.5, [10, 22, 38], 1);

// birds
for (const [bx, by, s] of [
  [300, 215, 18],
  [352, 178, 14],
  [248, 262, 12],
] as [number, number, number][]) {
  stroke(
    [
      [bx - s, by - 4],
      [bx, by + 2],
      [bx + s, by - 4],
    ],
    2.5,
    [10, 20, 40],
    0.85,
  );
}

// ---------- 6. the caption ----------
drawText("HEY JUDGE - HE CAME FOR THE MOON", 48, 44, 3, [220, 234, 255], 0.9);

// ---------- PNG encode (RGB, 8-bit, filter 0) ----------
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();
function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

const raw = Buffer.alloc(H * (1 + W * 3));
for (let y = 0; y < H; y++) {
  const ro = y * (1 + W * 3);
  raw[ro] = 0; // filter: None
  for (let x = 0; x < W; x++) {
    const si = (y * W + x) * 3;
    const di = ro + 1 + x * 3;
    raw[di] = clamp(Math.round(fb[si]), 0, 255);
    raw[di + 1] = clamp(Math.round(fb[si + 1]), 0, 255);
    raw[di + 2] = clamp(Math.round(fb[si + 2]), 0, 255);
  }
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 2; // color type RGB
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  pngChunk("IHDR", ihdr),
  pngChunk("IDAT", deflateSync(raw, { level: 9 })),
  pngChunk("IEND", Buffer.alloc(0)),
]);

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT_DIR + "/entry.png", png);
console.log("wrote " + OUT_DIR + "/entry.png (" + png.length + " bytes, " + W + "x" + H + ")");
