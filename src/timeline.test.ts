import { test } from "node:test";
import assert from "node:assert/strict";
import { cutAnchors, cutShape, paperColor, finalPaper, parseRecording, penCut, type TimelineEvent } from "./timeline.ts";

const loop = [[0, 0.5], [0.05, 0.55], [0, 0.6], [-0.05, 0.55]] as [number, number][];

test("a pen cut replays anchor by anchor, then closes", () => {
  const anchors = loop.map((point, i) => ({ point, handle: [0, 0] as [number, number], at: 1000 + [0, 10, 30, 60][i] }));
  const cut = { t: 0, k: "cut", tool: "pen", pts: penCut(anchors) } as const;
  assert.deepEqual(cut.pts.slice(0, 10), [0, 0.5, 0, 0, 0, 0.05, 0.55, 0, 0, 10]);
  assert.equal(cutAnchors(cut, 15).length, 2);
  assert.equal(cutShape(cut, 15).done, false);
  assert.deepEqual(cutShape(cut), { points: loop, done: true });
});

test("a pen cut keeps its anchors and handles", () => {
  const anchors = loop.map((point, i) => ({ point, handle: [i === 1 ? 0.02 : 0, 0] as [number, number], at: 500 + i * 100 }));
  const cut = { t: 0, k: "cut", tool: "pen", pts: penCut(anchors) } as const;
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
    { t: 45, k: "recut", tool: "surprise", pts: [0, 0, 0.1, 0, 0, 0.1] },
    { t: 50, k: "unfold" },
  ];
  const paper = finalPaper(events);
  assert.equal(paper.trimmed, true);
  assert.equal(paper.cuts.length, 1);
  assert.deepEqual(paper.cuts[0], [[0, 0], [0.1, 0], [0, 0.1]]);
  assert.equal(typeof parseRecording({ v: 1, events }), "object");
});

test("untrusted recordings are checked", () => {
  assert.equal(parseRecording(null), "not an object");
  assert.equal(parseRecording({ v: 2, events: [] }), "unknown version");
  assert.equal(parseRecording({ v: 1, events: [{ t: 0, k: "fold" }] }), "nothing was cut");
  assert.equal(parseRecording({ v: 1, events: [{ t: 0, k: "cut", tool: "pen", pts: [0, 0, 0, 1] }] }), "bad cut points");
  assert.equal(parseRecording({ v: 1, events: [{ t: 0, k: "cut", tool: "toString", pts: [0, 0, 0, 1] }] }), "bad cut tool");
  assert.equal(parseRecording({ v: 1, events: [{ t: 5, k: "fold" }, { t: 1, k: "trim" }] }), "bad time");
  assert.equal(parseRecording({ v: 1, events: [{ t: 0, k: "explode" }] }), "bad event kind");
});

test("the paper is kept, and defaults to today's", () => {
  const events = [{ t: 0, k: "cut", tool: "surprise", pts: loop.flat() }];
  assert.deepEqual((parseRecording({ v: 1, events }) as { paper: unknown }).paper, { id: "classic" });
  const paper = { id: "washi", params: { tint: "#f4efe4", weight: 60 } };
  assert.deepEqual((parseRecording({ v: 1, paper, events }) as { paper: unknown }).paper, paper);
  assert.equal(parseRecording({ v: 1, paper: { id: "../x" }, events }), "bad paper id");
  assert.equal(parseRecording({ v: 1, paper: { id: "a", params: { x: {} } }, events }), "bad paper params");
});

test("the fold method is kept, and defaults to diagonal", () => {
  const events = [{ t: 0, k: "cut", tool: "surprise", pts: loop.flat() }];
  assert.equal((parseRecording({ v: 1, events }) as { fold: string }).fold, "diagonal");
  assert.equal((parseRecording({ v: 1, fold: "square-cone", events }) as { fold: string }).fold, "square-cone");
  assert.equal(parseRecording({ v: 1, fold: 3, events }), "bad fold method");
});

test("the paper colour is kept, and white when unset", () => {
  assert.equal(paperColor({ id: "classic" }), "#ffffff");
  assert.equal(paperColor({ id: "classic", params: { color: "#F7D6E0" } }), "#F7D6E0");
  assert.equal(paperColor({ id: "classic", params: { color: "red; x" } }), "#ffffff");
});
