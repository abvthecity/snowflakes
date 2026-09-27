import { test } from "node:test";
import assert from "node:assert/strict";
import { cutShape, finalPaper, freehandCut, parseRecording, penCut, type TimelineEvent } from "./timeline.ts";

const loop = [[0, 0.5], [0.05, 0.55], [0, 0.6], [-0.05, 0.55]] as [number, number][];

test("a freehand cut replays point by point, then closes", () => {
  const cut = { t: 0, k: "cut", tool: "freehand", pts: freehandCut(loop, [1000, 1010, 1030, 1060]) } as const;
  assert.deepEqual(cut.pts.slice(0, 6), [0, 0.5, 0, 0.05, 0.55, 10]);
  assert.equal(cutShape(cut, 15).points.length, 2);
  assert.equal(cutShape(cut, 15).done, false);
  assert.deepEqual(cutShape(cut), { points: loop, done: true });
});

test("a pen cut keeps its anchors and handles", () => {
  const anchors = loop.map((point, i) => ({ point, handle: [i === 1 ? 0.02 : 0, 0] as [number, number], at: 500 + i * 100 }));
  const cut = { t: 0, k: "cut", tool: "curve", pts: penCut(anchors) } as const;
  assert.equal(cutShape(cut, 150).points.length > 2, true);
  assert.equal(cutShape(cut).done, true);
});

test("the final paper undoes cuts and remembers the trim", () => {
  const events: TimelineEvent[] = [
    { t: 0, k: "fold" },
    { t: 10, k: "trim" },
    { t: 20, k: "cut", tool: "surprise", pts: loop.flat() },
    { t: 30, k: "cut", tool: "surprise", pts: loop.flat() },
    { t: 40, k: "undo" },
    { t: 50, k: "unfold" },
  ];
  const paper = finalPaper(events);
  assert.equal(paper.trimmed, true);
  assert.equal(paper.cuts.length, 1);
  assert.equal(typeof parseRecording({ v: 1, events }), "object");
});

test("untrusted recordings are checked", () => {
  assert.equal(parseRecording(null), "not an object");
  assert.equal(parseRecording({ v: 2, events: [] }), "unknown version");
  assert.equal(parseRecording({ v: 1, events: [{ t: 0, k: "fold" }] }), "nothing was cut");
  assert.equal(parseRecording({ v: 1, events: [{ t: 0, k: "cut", tool: "freehand", pts: [0, 0, 0, 1] }] }), "bad cut points");
  assert.equal(parseRecording({ v: 1, events: [{ t: 5, k: "fold" }, { t: 1, k: "trim" }] }), "bad time");
  assert.equal(parseRecording({ v: 1, events: [{ t: 0, k: "explode" }] }), "bad event kind");
});
