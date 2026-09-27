// Sample cut patterns for "Surprise me" and the ?demo URL: notches along the
// folds and the open edge, and a few holes, all within the folded wedge.
import type { Vec2 } from "./folds";

const DEG = Math.PI / 180;

/** A point in the wedge, by distance from the centre and angle (90°–112.5°). */
const polar = (r: number, deg: number): Vec2 => [r * Math.cos(deg * DEG), r * Math.sin(deg * DEG)];

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

export function randomCuts(seed = Math.floor(Math.random() * 1e9)): Vec2[][] {
  const rand = mulberry32(seed);
  const cuts: Vec2[][] = [];

  // Trim the uneven top of the folded stack along a scalloped or pointed edge.
  const top = 0.82 + rand() * 0.12;
  const peaks = 2 + Math.floor(rand() * 3);
  const edge: Vec2[] = [[0.2, 2]];
  for (let i = 0; i <= peaks * 2; i++) {
    const x = 0.02 - (i / (peaks * 2)) * 0.62;
    const y = top + (i % 2 ? -0.1 - rand() * 0.08 : 0);
    edge.push([x, y]);
  }
  edge.push([-0.8, 2]);
  cuts.push(edge);

  // Notches cut in from the fold at 90° (the right-hand edge of the wedge).
  const notches = 2 + Math.floor(rand() * 3);
  for (let i = 0; i < notches; i++) {
    const r = 0.18 + (i + rand() * 0.6) * (0.62 / notches);
    const depth = 0.05 + rand() * 0.09;
    const w = 0.03 + rand() * 0.05;
    cuts.push([
      [0.1, r - w],
      [-depth, r + (rand() - 0.5) * 0.04],
      [0.1, r + w],
    ]);
  }

  // Notches cut in from the fold at 112.5° (the left-hand edge).
  for (let i = 0; i < 2 + Math.floor(rand() * 2); i++) {
    const r = 0.25 + rand() * 0.5;
    const outside = polar(r, 118);
    const inside = polar(r + (rand() - 0.5) * 0.08, 112.5 - 5 - rand() * 7);
    const along = 0.03 + rand() * 0.05;
    cuts.push([polar(r - along, 118), inside, polar(r + along, 118), outside]);
  }

  // A few holes in the middle of the wedge.
  for (let i = 0; i < 1 + Math.floor(rand() * 3); i++) {
    const [cx, cy] = polar(0.3 + rand() * 0.45, 98 + rand() * 9);
    cuts.push(ellipse(cx, cy, 0.015 + rand() * 0.03, 0.03 + rand() * 0.05, rand() * Math.PI));
  }

  // Snip the point so the centre opens into a small star.
  cuts.push([
    [0.1, -0.1],
    [0.1, 0.06 + rand() * 0.05],
    polar(0.05 + rand() * 0.05, 106),
    [-0.2, -0.1],
  ]);
  return cuts;
}
