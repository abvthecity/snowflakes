import { test } from "node:test";
import assert from "node:assert/strict";
import { COVER, SECTORS, TRIM_LINE, WEDGE, apply, invert } from "./folds.ts";

const deg = (r: number) => (r * 180) / Math.PI;

test("every sector folds into the 75°–105° wedge", () => {
  for (const s of SECTORS) {
    const [c, a, b] = s.triangle;
    const mid: [number, number] = [(c[0] + a[0] + b[0]) / 3, (c[1] + a[1] + b[1]) / 3];
    const p = apply(s.folded, mid);
    const t = Math.atan2(p[1], p[0]);
    assert.ok(t > WEDGE[0] && t < WEDGE[1], `sector ${s.index} lands at ${deg(t)}°`);
  }
});

test("the folded paper is twelve distinct layers", () => {
  const layers = SECTORS.map((s) => s.layers[4]).sort((x, y) => x - y);
  assert.deepEqual(layers, [...Array(12).keys()]);
});

test("the folds move half, half, then a third each way", () => {
  const moved = [0, 1, 2, 3].map((i) => SECTORS.filter((s) => s.moves[i]).length);
  assert.deepEqual(moved, [6, 6, 4, 4]);
});

test("no layer lands on another mid-fold: each fold stacks on top of what stays", () => {
  for (let i = 0; i < 4; i++) {
    const keptTop = Math.max(...SECTORS.filter((s) => !s.moves[i]).map((s) => s.layers[i + 1]));
    const movedBottom = Math.min(...SECTORS.filter((s) => s.moves[i]).map((s) => s.layers[i + 1]));
    assert.equal(movedBottom, keptTop + 1);
  }
});

test("the trim opens into a regular hexagon", () => {
  // Unfolded, the two ends of the trim land on six corners and six side midpoints.
  const corners = new Set<number>();
  for (const s of SECTORS) {
    const back = invert(s.folded);
    for (const [k, p] of TRIM_LINE.entries()) {
      const q = apply(back, p);
      const a = (((Math.round(deg(Math.atan2(q[1], q[0]))) % 360) + 360) % 360);
      if (k === 0) corners.add(a);
      assert.ok(Math.abs(Math.hypot(q[0], q[1]) - Math.hypot(p[0], p[1])) < 1e-9);
    }
  }
  const angles = [...corners].sort((x, y) => x - y);
  assert.equal(angles.length, 6);
  angles.forEach((a, i) => assert.equal((a - angles[0] + 360) % 360, i * 60));
});

test("a flat sheet hides nothing; folded up, all but the outside layers are covered", () => {
  assert.ok(COVER[0].every((c) => !c.above && !c.below));
  const seen = (side: "above" | "below") => SECTORS.filter((s) => !COVER[4][s.index][side]).map((s) => s.layers[4]);
  assert.ok(seen("above").includes(11) && seen("above").length < 12, `from the front: ${seen("above")}`);
  assert.ok(seen("below").includes(0) && seen("below").length < 12, `from the back: ${seen("below")}`);
});
