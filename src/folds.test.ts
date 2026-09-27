import { test } from "node:test";
import assert from "node:assert/strict";
import { FOLD_METHODS, TRIM_LINE, WEDGE, apply, foldMethod, invert } from "./folds.ts";

const deg = (r: number) => (r * 180) / Math.PI;

/** How many of the 12 sectors each fold moves. */
const MOVED: Record<string, number[]> = {
  diagonal: [6, 6, 4, 4], // half, half, then a third each way
  half: [6, 4, 4, 6], // half, a third each way, then half
};

test("fold method ids are unique and resolve", () => {
  assert.equal(new Set(FOLD_METHODS.map((m) => m.id)).size, FOLD_METHODS.length);
  for (const m of FOLD_METHODS) assert.equal(foldMethod(m.id), m);
  assert.equal(foldMethod("nonsense"), FOLD_METHODS[0]);
});

for (const method of FOLD_METHODS) {
  const { sectors } = method;

  test(`${method.id}: the sectors tile the square`, () => {
    const area = sectors.reduce((sum, s) => {
      const o = s.outline;
      let a = 0;
      for (let i = 0; i < o.length; i++) {
        const [x0, y0] = o[i];
        const [x1, y1] = o[(i + 1) % o.length];
        a += x0 * y1 - x1 * y0;
      }
      assert.ok(a > 0, `sector ${s.index} winds counter-clockwise`);
      return sum + a / 2;
    }, 0);
    assert.ok(Math.abs(area - 4) < 1e-9, `area ${area}`);
  });

  test(`${method.id}: every sector folds into the 75°–105° wedge`, () => {
    for (const s of sectors) {
      const [c, a, b] = [s.outline[0], s.outline[1], s.outline[s.outline.length - 1]];
      const mid: [number, number] = [(c[0] + a[0] + b[0]) / 3, (c[1] + a[1] + b[1]) / 3];
      const p = apply(s.folded, mid);
      const t = Math.atan2(p[1], p[0]);
      assert.ok(t > WEDGE[0] && t < WEDGE[1], `sector ${s.index} lands at ${deg(t)}°`);
    }
  });

  test(`${method.id}: the folded paper is twelve distinct layers`, () => {
    const layers = sectors.map((s) => s.layers[4]).sort((x, y) => x - y);
    assert.deepEqual(layers, [...Array(12).keys()]);
  });

  test(`${method.id}: each fold moves the expected share of the paper`, () => {
    const moved = [0, 1, 2, 3].map((i) => sectors.filter((s) => s.moves[i]).length);
    assert.deepEqual(moved, MOVED[method.id]);
  });

  test(`${method.id}: no layer lands on another mid-fold: each fold stacks on top of what stays`, () => {
    for (let i = 0; i < 4; i++) {
      const keptTop = Math.max(...sectors.filter((s) => !s.moves[i]).map((s) => s.layers[i + 1]));
      const movedBottom = Math.min(...sectors.filter((s) => s.moves[i]).map((s) => s.layers[i + 1]));
      assert.equal(movedBottom, keptTop + 1);
    }
  });

  test(`${method.id}: the ridge tilts each sector's two sides in opposite directions`, () => {
    for (const s of sectors) {
      const a = s.outline[1];
      const b = s.outline[s.outline.length - 1];
      const z = (p: readonly number[]) => s.ridge[0] * p[0] + s.ridge[1] * p[1];
      const sign = s.index % 2 ? 1 : -1;
      assert.ok(Math.abs(z(a) - sign * Math.hypot(a[0], a[1])) < 1e-9);
      assert.ok(Math.abs(z(b) + sign * Math.hypot(b[0], b[1])) < 1e-9);
    }
  });

  test(`${method.id}: a flat sheet hides nothing; folded up, all but the outside layers are covered`, () => {
    const { cover } = method;
    assert.ok(cover[0].every((c) => !c.above && !c.below));
    const seen = (side: "above" | "below") => sectors.filter((s) => !cover[4][s.index][side]).map((s) => s.layers[4]);
    assert.ok(seen("above").includes(11) && seen("above").length < 12, `from the front: ${seen("above")}`);
    assert.ok(seen("below").includes(0) && seen("below").length < 12, `from the back: ${seen("below")}`);
  });

  test(`${method.id}: the trim opens into a regular hexagon`, () => {
    // Unfolded, the two ends of the trim land on six corners and six side midpoints.
    const corners = new Set<number>();
    for (const s of sectors) {
      const back = invert(s.folded);
      for (const [k, p] of TRIM_LINE.entries()) {
        const q = apply(back, p);
        const a = ((Math.round(deg(Math.atan2(q[1], q[0]))) % 360) + 360) % 360;
        if (k === 0) corners.add(a);
        assert.ok(Math.abs(Math.hypot(q[0], q[1]) - Math.hypot(p[0], p[1])) < 1e-9);
      }
    }
    const angles = [...corners].sort((x, y) => x - y);
    assert.equal(angles.length, 6);
    angles.forEach((a, i) => assert.equal((a - angles[0] + 360) % 360, i * 60));
  });
}
