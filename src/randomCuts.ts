// Sample cut patterns for "Surprise me" and the ?demo URL: points along the
// trimmed top, notches in from both folds, and a few holes, all within the
// folded 75°–105° wedge.
import { TRIM_LINE, WEDGE, polar, type Vec2 } from "./folds";

const DEG = Math.PI / 180;
const [RIGHT, LEFT] = WEDGE;

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function ellipse(cx: number, cy: number, rx: number, ry: number, rot: number, n = 28): Vec2[] {
  return Array.from({ length: n }, (_, i) => {
    const t = (i / n) * Math.PI * 2;
    const x = Math.cos(t) * rx;
    const y = Math.sin(t) * ry;
    return [cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)];
  });
}

/** A triangular notch cut in from the fold at angle `edge`, centred `r` from the middle. */
function foldNotch(edge: number, inward: number, r: number, depth: number, width: number, lean: number): Vec2[] {
  const outside = edge - inward * 8 * DEG;
  return [polar(r - width, outside), polar(r + lean, edge + inward * depth), polar(r + width, outside)];
}

export function randomCuts(seed = Math.floor(Math.random() * 1e9)): Vec2[][] {
  const rand = mulberry32(seed);
  const cuts: Vec2[][] = [];

  // Points along the trimmed top: V-shaped bites down from the trim line.
  const [p, q] = TRIM_LINE;
  const along = [q[0] - p[0], q[1] - p[1]];
  const len = Math.hypot(along[0], along[1]);
  const down: Vec2 = [along[1] / len, -along[0] / len];
  const bites = 1 + Math.floor(rand() * 3);
  for (let i = 0; i < bites; i++) {
    const t = (i + 0.5 + (rand() - 0.5) * 0.4) / bites;
    const w = (0.12 + rand() * 0.2) / bites;
    const d = 0.05 + rand() * 0.1;
    const at = (u: number, k: number): Vec2 => [p[0] + along[0] * u - down[0] * k, p[1] + along[1] * u - down[1] * k];
    cuts.push([at(t - w, 0.05), [at(t, 0)[0] + down[0] * d, at(t, 0)[1] + down[1] * d], at(t + w, 0.05)]);
  }

  // Notches cut in from each fold.
  for (const [edge, inward] of [
    [RIGHT, 1],
    [LEFT, -1],
  ] as const) {
    const n = 2 + Math.floor(rand() * 2);
    for (let i = 0; i < n; i++) {
      const r = 0.2 + (i + 0.2 + rand() * 0.6) * (0.55 / n);
      cuts.push(foldNotch(edge, inward, r, (5 + rand() * 9) * DEG, 0.025 + rand() * 0.04, (rand() - 0.5) * 0.06));
    }
  }

  // A few holes in the middle of the wedge.
  for (let i = 0; i < 1 + Math.floor(rand() * 2); i++) {
    const [cx, cy] = polar(0.3 + rand() * 0.4, 85 * DEG + rand() * 10 * DEG);
    cuts.push(ellipse(cx, cy, 0.012 + rand() * 0.02, 0.025 + rand() * 0.04, rand() * Math.PI));
  }

  // Snip the point so the centre opens into a small star.
  const snip = 0.05 + rand() * 0.06;
  cuts.push([[0.3, -0.1], polar(snip * 1.4, RIGHT), polar(snip, 90 * DEG), polar(snip * 1.4, LEFT), [-0.3, -0.1]]);
  return cuts;
}
