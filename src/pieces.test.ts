import { test } from "node:test";
import assert from "node:assert/strict";
import { TRIM_LINE, polar } from "./folds.ts";
import { cutPaper, edgeDistance } from "./pieces.ts";

// A strip of paper 3 wide and 10 tall, its centre at the bottom middle, the
// trimmed edge 10 pixels up. `cut` rows are marked with "x".
const W = 3;
const H = 10;
const strip = () => new Uint8Array(W * H).fill(1);
const rows = (...ys: number[]) => {
  const c = new Uint8Array(W * H);
  for (const y of ys) c.fill(1, y * W, y * W + W);
  return c;
};
const edge = () => H;
/** Which rows still have paper, as a string from the top: # paper, . none. */
const show = (p: Uint8Array) => Array.from({ length: H }, (_, y) => (p[y * W] ? "#" : ".")).join("");

test("a cut that doesn't sever the paper takes only itself", () => {
  const cut = new Uint8Array(W * H);
  cut[4 * W + 1] = 1;
  const left = cutPaper(strip(), cut, W, H, 1, H, edge);
  assert.equal(left.reduce((a, b) => a + b, 0), W * H - 1);
});

test("a cut across the outer half tosses the outer piece", () => {
  // Rows 0–2 are the far end; row 3 is 7 of 10 pixels out.
  assert.equal(show(cutPaper(strip(), rows(3), W, H, 1, H, edge)), "....######");
});

test("a cut across the inner half tosses the centre piece", () => {
  // Row 7 is 3 of 10 pixels out from the centre, at the bottom.
  assert.equal(show(cutPaper(strip(), rows(7), W, H, 1, H, edge)), "#######...");
});

test("the trimmed edge is where the geometry puts it", () => {
  const [a, b] = TRIM_LINE;
  for (const p of [a, b, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] as const]) {
    assert.ok(Math.abs(edgeDistance(p[0], p[1]) - Math.hypot(p[0], p[1])) < 1e-9);
  }
  assert.ok(Math.abs(edgeDistance(...polar(1, Math.PI / 2)) - 0.9) < 0.1);
});
