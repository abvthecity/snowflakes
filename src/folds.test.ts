import { test } from "node:test";
import assert from "node:assert/strict";
import { SECTORS, apply, side, invert, mul, IDENTITY } from "./folds.ts";

const WEDGE_LO = (90 * Math.PI) / 180;
const WEDGE_HI = (112.5 * Math.PI) / 180;

test("every sector folds into the 90°–112.5° wedge", () => {
  for (const s of SECTORS) {
    const [c, a, b] = s.triangle;
    const mid: [number, number] = [(c[0] + a[0] + b[0]) / 3, (c[1] + a[1] + b[1]) / 3];
    const p = apply(s.folded, mid);
    const t = Math.atan2(p[1], p[0]);
    assert.ok(t > WEDGE_LO && t < WEDGE_HI, `sector ${s.index} lands at ${(t * 180) / Math.PI}°`);
  }
});

test("folding four times stacks sixteen distinct layers", () => {
  const layers = SECTORS.map((s) => s.layers[4]).sort((x, y) => x - y);
  assert.deepEqual(layers, [...Array(16).keys()]);
});

test("each fold moves exactly half the sectors", () => {
  for (let i = 0; i < 4; i++) {
    assert.equal(SECTORS.filter((s) => s.moves[i]).length, 8);
  }
});

test("the kept sector never moves, and folded maps are reflections or rotations", () => {
  const kept = SECTORS[4];
  assert.deepEqual(kept.moves, [false, false, false, false]);
  for (const s of SECTORS) {
    const m = mul(s.folded, invert(s.folded));
    m.forEach((v, i) => assert.ok(Math.abs(v - IDENTITY[i]) < 1e-9));
    assert.ok(Math.abs(Math.abs(s.folded[0] * s.folded[3] - s.folded[1] * s.folded[2]) - 1) < 1e-9);
  }
  assert.ok(side(0, [0, 1]) > 0);
});
