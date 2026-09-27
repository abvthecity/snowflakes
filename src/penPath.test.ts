import { test } from "node:test";
import assert from "node:assert/strict";
import { fitStroke, isSmooth, outline, toggleSmooth, type Anchor } from "./penPath.ts";

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

const circle = (n: number, r = 0.1, jitter = 0): [number, number][] =>
  Array.from({ length: n }, (_, i) => {
    const t = (i / n) * 2 * Math.PI;
    const wobble = jitter * Math.sin(i * 7.3);
    return [(r + wobble) * Math.cos(t), (r + wobble) * Math.sin(t)];
  });

test("a freehand loop is fitted with a few smooth anchors that stay close to it", () => {
  const stroke = circle(120, 0.1, 0.003);
  const anchors = fitStroke(stroke, true, 0.006);
  assert.ok(anchors.length >= 4 && anchors.length <= 12, `${anchors.length} anchors`);
  assert.ok(anchors.every(isSmooth), "a circle has no corners");
  for (const [x, y] of outline(anchors, true)) assert.ok(Math.abs(Math.hypot(x, y) - 0.1) < 0.012);
});

test("a sharp turn in a freehand stroke stays a corner", () => {
  const stroke: [number, number][] = [];
  for (let i = 0; i <= 30; i++) stroke.push([i / 100, 0]);
  for (let i = 1; i <= 30; i++) stroke.push([0.3, i / 100]);
  const anchors = fitStroke(stroke, false, 0.004);
  assert.equal(anchors.length, 3);
  assert.ok(Math.hypot(anchors[1].point[0] - 0.3, anchors[1].point[1]) < 0.01);
  assert.ok(!isSmooth(anchors[1]));
});

test("a tapped corner can be rounded and sharpened again", () => {
  const square = [at(0, 0), at(1, 0), at(1, 1), at(0, 1)];
  const round = toggleSmooth(square, 1, true);
  assert.ok(isSmooth(round[1]));
  // Along the line from its neighbours, (0,0) to (1,1).
  assert.ok(Math.abs(round[1].handle[0] - round[1].handle[1]) < 1e-12 && round[1].handle[0] > 0);
  assert.deepEqual(toggleSmooth(round, 1, true), square);
});
