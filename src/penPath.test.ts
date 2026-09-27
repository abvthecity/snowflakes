import { test } from "node:test";
import assert from "node:assert/strict";
import { outline, type Anchor } from "./penPath.ts";

const at = (x: number, y: number, hx = 0, hy = 0): Anchor => ({ point: [x, y], handle: [hx, hy] });

test("clicks without handles make straight segments, one point per corner", () => {
  const tri = [at(0, 0), at(1, 0), at(0, 1)];
  assert.deepEqual(outline(tri, true), [
    [0, 0],
    [1, 0],
    [0, 1],
  ]);
});

test("a dragged handle bends the segment and it still passes through the anchors", () => {
  const path = [at(0, 0, 0, 0.5), at(1, 0), at(0.5, -1)];
  const pts = outline(path, true, 10);
  assert.deepEqual(pts[0], [0, 0]);
  assert.ok(pts.some(([x, y]) => Math.abs(x - 1) < 1e-9 && Math.abs(y) < 1e-9));
  // The curve bulges upward, toward the handle.
  assert.ok(pts.slice(1, 10).every(([, y]) => y > 0));
});

test("an open path ends on its last anchor", () => {
  const pts = outline([at(0, 0), at(2, 0)], false);
  assert.deepEqual(pts, [
    [0, 0],
    [2, 0],
  ]);
});
