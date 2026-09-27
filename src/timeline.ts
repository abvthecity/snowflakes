// A snowflake is saved as the story of how it was made: every fold, the trim,
// each cut as it was drawn, undos, unfolds. That is a few KB of JSON, and
// replaying it rebuilds the paper exactly and shows the cutting again in 3D.
//
// Times are milliseconds since the paper was picked up. A cut keeps its drawing
// too, with times relative to the cut's start:
//
//   freehand  pts = [x, y, ms, x, y, ms, …], the stroke as it was drawn
//   straight,
//   curve     pts = [x, y, hx, hy, ms, …], each pen anchor with its handle
//   surprise  pts = [x, y, x, y, …], a ready-made outline
//
// The functions here run in the browser and in the Pages Function that
// stores recordings, which checks them with `parseRecording`.
import type { Vec2 } from "./folds.ts";
import { outline, type Anchor } from "./penPath.ts";

export type CutKind = "freehand" | "straight" | "curve" | "surprise";

export type TimelineEvent =
  | { t: number; k: "fold" | "trim" | "undo" | "unfold" | "refold" }
  | { t: number; k: "cut"; tool: CutKind; pts: number[] };

export interface Recording {
  v: 1;
  events: TimelineEvent[];
}

/** Numbers per point in each kind of cut. */
const STRIDE: Record<CutKind, number> = { freehand: 3, straight: 5, curve: 5, surprise: 2 };

/** Limits a stored recording must stay within. */
export const LIMITS = { bytes: 512 * 1024, events: 2000, points: 4000 };

/** Coordinates to 1/10 000 of the paper, which keeps the JSON small without a visible difference. */
const q = (n: number) => Math.round(n * 1e4) / 1e4;

/** A freehand stroke, with when each point was drawn (any clock, in ms). */
export function freehandCut(points: readonly Vec2[], times: readonly number[]): number[] {
  const start = times[0] ?? 0;
  return points.flatMap(([x, y], i) => [q(x), q(y), Math.round((times[i] ?? start) - start)]);
}

/** A pen path, with when each anchor was placed (its `at`). */
export function penCut(anchors: readonly Anchor[]): number[] {
  const start = anchors[0]?.at ?? 0;
  return anchors.flatMap((a) => [q(a.point[0]), q(a.point[1]), q(a.handle[0]), q(a.handle[1]), Math.round((a.at ?? start) - start)]);
}

export function outlineCut(points: readonly Vec2[]): number[] {
  return points.flatMap(([x, y]) => [q(x), q(y)]);
}

type Cut = Extract<TimelineEvent, { k: "cut" }>;

/** How long drawing the cut took, in ms. */
export function drawTime(cut: Cut): number {
  const n = STRIDE[cut.tool];
  if (cut.tool === "surprise" || cut.pts.length < n) return 0;
  return cut.pts[cut.pts.length - 1];
}

/**
 * The cut as it looked `ms` into drawing it: the stroke or pen path so far
 * (open), or the closed outline that was cut once `ms` reaches the end.
 */
export function cutShape(cut: Cut, ms = Infinity): { points: Vec2[]; done: boolean } {
  const n = STRIDE[cut.tool];
  const count = cut.pts.length / n;
  const done = ms >= drawTime(cut);
  if (cut.tool === "freehand" || cut.tool === "surprise") {
    const points: Vec2[] = [];
    for (let i = 0; i < count; i++) {
      if (!done && cut.tool === "freehand" && cut.pts[i * n + 2] > ms) break;
      points.push([cut.pts[i * n], cut.pts[i * n + 1]]);
    }
    return { points, done };
  }
  const anchors: Anchor[] = [];
  for (let i = 0; i < count; i++) {
    const o = i * n;
    if (!done && cut.pts[o + 4] > ms) break;
    anchors.push({ point: [cut.pts[o], cut.pts[o + 1]], handle: [cut.pts[o + 2], cut.pts[o + 3]] });
  }
  return { points: outline(anchors, done), done };
}

/** What the paper looks like at the end: whether it was trimmed, and the cuts still on it. */
export function finalPaper(events: readonly TimelineEvent[]) {
  let trimmed = false;
  const cuts: Vec2[][] = [];
  for (const e of events) {
    if (e.k === "trim") trimmed = true;
    else if (e.k === "cut") cuts.push(cutShape(e).points);
    else if (e.k === "undo") cuts.pop();
  }
  return { trimmed, cuts };
}

const KINDS = new Set(["fold", "trim", "undo", "unfold", "refold", "cut"]);

/** Checks untrusted JSON is a recording within `LIMITS`; returns it, or a reason it isn't. */
export function parseRecording(json: unknown): Recording | string {
  if (typeof json !== "object" || json === null) return "not an object";
  const { v, events } = json as Partial<Recording>;
  if (v !== 1) return "unknown version";
  if (!Array.isArray(events) || events.length === 0) return "no events";
  if (events.length > LIMITS.events) return "too many events";
  let points = 0;
  let last = 0;
  for (const e of events as unknown[]) {
    if (typeof e !== "object" || e === null) return "bad event";
    const { t, k } = e as { t: unknown; k: unknown };
    if (typeof t !== "number" || !Number.isFinite(t) || t < last) return "bad time";
    last = t;
    if (typeof k !== "string" || !KINDS.has(k)) return "bad event kind";
    if (k !== "cut") continue;
    const { tool, pts } = e as { tool: unknown; pts: unknown };
    if (typeof tool !== "string" || !(tool in STRIDE)) return "bad cut tool";
    const n = STRIDE[tool as CutKind];
    if (!Array.isArray(pts) || pts.length < n * 2 || pts.length % n) return "bad cut points";
    if (!pts.every((p) => typeof p === "number" && Number.isFinite(p) && Math.abs(p) < 1e7)) return "bad cut points";
    points += pts.length / n;
    if (points > LIMITS.points) return "too many points";
  }
  if (!events.some((e) => e.k === "cut")) return "nothing was cut";
  return { v: 1, events: events as TimelineEvent[] };
}

/** Collects events as they happen. */
export class Recorder {
  private start = performance.now();
  private offset = 0;
  events: TimelineEvent[] = [];

  /** Start a new sheet of paper. */
  reset() {
    this.events = [];
    this.offset = 0;
    this.start = performance.now();
  }

  /** Carry on from a saved recording, as though its story had just happened. */
  resume(r: Recording) {
    this.events = [...r.events];
    this.offset = (r.events[r.events.length - 1]?.t ?? 0) + 1000;
    this.start = performance.now();
  }

  now() {
    return Math.round(this.offset + performance.now() - this.start);
  }

  add(e: { k: "fold" | "trim" | "undo" | "unfold" | "refold" } | { k: "cut"; tool: CutKind; pts: number[] }) {
    this.events.push({ t: this.now(), ...e } as TimelineEvent);
  }

  get recording(): Recording {
    return { v: 1, events: this.events };
  }
}
