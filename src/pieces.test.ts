import { test } from "node:test";
import assert from "node:assert/strict";
import { strays } from "./pieces.ts";

// Rows of a small grid: # is paper, . is cut.
const grid = (rows: string[]) => ({
  w: rows[0].length,
  h: rows.length,
  paper: Uint8Array.from(rows.join("").split(""), (c) => (c === "#" ? 1 : 0)),
});
const show = (out: Uint8Array, w: number) =>
  Array.from({ length: out.length / w }, (_, y) => Array.from(out.slice(y * w, y * w + w), (v) => (v ? "x" : "-")).join(""));

test("paper in one piece loses nothing", () => {
  const { w, h, paper } = grid(["####", "#..#", "####"]);
  assert.ok(!strays(paper, w, h, 0, 0).some(Boolean));
});

test("a cut right across tosses the far piece and keeps the one at the centre", () => {
  const { w, h, paper } = grid(["###", "...", "###", "###"]);
  // The centre is at the bottom.
  assert.deepEqual(show(strays(paper, w, h, 1, 3), w), ["xxx", "---", "---", "---"]);
});

test("with the centre cut out, the piece nearest it stays", () => {
  const { w, h, paper } = grid(["#####", ".....", ".....", "##...", "##..."]);
  assert.deepEqual(show(strays(paper, w, h, 4, 4), w), ["xxxxx", "-----", "-----", "-----", "-----"]);
});
