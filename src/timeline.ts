// A snowflake is saved as the story of how it was made: every fold, the trim,
// each cut as it was drawn, each reshaping of a finished cut, undos, unfolds. That is a few KB of JSON, and
// replaying it rebuilds the paper exactly and shows the cutting again in 3D.
//
// Times are milliseconds since the paper was picked up. A cut keeps its drawing
// too, with times relative to the cut's start:
//
//   pen       pts = [x, y, hx, hy, ms, …], each anchor of the scissors' path
//             with its outgoing handle (zero for a corner; the incoming one
//             mirrors it for a curve) and when it was placed
//   surprise  pts = [x, y, x, y, …], a ready-made outline
//
// A "recut" is the last cut reshaped (a point or handle dragged, a corner
// rounded): it replaces that cut with its new path.
//
// The functions here run in the browser and in the Pages Function that
// stores recordings, which checks them with `parseRecording`.
import type { Vec2 } from "./folds.ts";
import { outline, type Anchor } from "./penPath.ts";

export type CutKind = "pen" | "surprise";

export type TimelineEvent =
  | { t: number; k: "fold" | "trim" | "undo" | "unfold" | "refold" }
  | { t: number; k: "cut" | "recut"; tool: CutKind; pts: number[] };

/** Everything but the time, as the app hands events to the recorder. */
export type Step =
  | { k: "fold" | "trim" | "undo" | "unfold" | "refold" }
  | { k: "cut" | "recut"; tool: CutKind; pts: number[] };

/** Which paper the snowflake was cut from, and any settings it takes (colour, weight…). */
export interface PaperChoice {
  id: string;
  params?: Record<string, string | number | boolean>;
}

/** Today's paper, and what recordings without a `paper` were cut from. */
export const DEFAULT_PAPER: PaperChoice = { id: "classic" };

/** The paper's colour, saved as `params.color` ("#rrggbb"); white when it wasn't chosen. */
export function paperColor(paper: PaperChoice): string {
  const c = paper.params?.color;
  return typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c) ? c : "#ffffff";
}

/**
 * How the paper was folded: "diagonal" is today's corner-to-corner, half, then
 * thirds; other methods (such as a square first, then a cone) get their own ids.
 * Replays fold the same way, so every fold event means a step of this method.
 */
export const DEFAULT_FOLD_METHOD = "diagonal";

export interface Recording {
  v: 1;
  fold: string;
  paper: PaperChoice;
  events: TimelineEvent[];
}

/** Numbers per point in each kind of cut. */
const STRIDE: Record<CutKind, number> = { pen: 5, surprise: 2 };

/** Limits a stored recording must stay within. */
export const LIMITS = { bytes: 512 * 1024, events: 2000, points: 4000 };

/** Coordinates to 1/10 000 of the paper, which keeps the JSON small without a visible difference. */
const q = (n: number) => Math.round(n * 1e4) / 1e4;

/** A pen path, with when each anchor was placed (its `at`). */
export function penCut(anchors: readonly Anchor[]): number[] {
  const start = anchors[0]?.at ?? 0;
  return anchors.flatMap((a) => [q(a.point[0]), q(a.point[1]), q(a.handle[0]), q(a.handle[1]), Math.round((a.at ?? start) - start)]);
}

export function outlineCut(points: readonly Vec2[]): number[] {
  return points.flatMap(([x, y]) => [q(x), q(y)]);
}

type Cut = Extract<Step, { k: "cut" | "recut" }>;

/** The anchors of a pen cut, as far as `ms` into drawing it. */
export function cutAnchors(cut: Cut, ms = Infinity): Anchor[] {
  const anchors: Anchor[] = [];
  if (cut.tool !== "pen") return anchors;
  for (let o = 0; o + 5 <= cut.pts.length; o += 5) {
    if (cut.pts[o + 4] > ms) break;
    anchors.push({ point: [cut.pts[o], cut.pts[o + 1]], handle: [cut.pts[o + 2], cut.pts[o + 3]] });
  }
  return anchors;
}

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
  const done = ms >= drawTime(cut);
  if (cut.tool === "surprise") {
    const points: Vec2[] = [];
    for (let o = 0; o + 2 <= cut.pts.length; o += 2) points.push([cut.pts[o], cut.pts[o + 1]]);
    return { points, done };
  }
  return { points: outline(cutAnchors(cut, done ? Infinity : ms), done), done };
}

/** What the paper looks like at the end: whether it was trimmed, and the cuts still on it. */
export function finalPaper(events: readonly TimelineEvent[]) {
  let trimmed = false;
  const cuts: Vec2[][] = [];
  for (const e of events) {
    if (e.k === "trim") trimmed = true;
    else if (e.k === "cut") cuts.push(cutShape(e).points);
    else if (e.k === "recut") cuts.splice(-1, 1, cutShape(e).points);
    else if (e.k === "undo") cuts.pop();
  }
  return { trimmed, cuts };
}

const KINDS = new Set(["fold", "trim", "undo", "unfold", "refold", "cut", "recut"]);

function parsePaper(json: unknown): PaperChoice | string {
  if (json === undefined) return DEFAULT_PAPER;
  if (typeof json !== "object" || json === null) return "bad paper";
  const { id, params } = json as Partial<PaperChoice>;
  if (typeof id !== "string" || !/^[a-z0-9-]{1,32}$/.test(id)) return "bad paper id";
  if (params === undefined) return { id };
  if (typeof params !== "object" || params === null || Array.isArray(params)) return "bad paper params";
  const entries = Object.entries(params);
  if (entries.length > 16) return "too many paper params";
  for (const [k, v] of entries) {
    if (!/^[A-Za-z0-9_]{1,32}$/.test(k)) return "bad paper params";
    if (!(typeof v === "number" ? Number.isFinite(v) : typeof v === "boolean" || (typeof v === "string" && v.length <= 64)))
      return "bad paper params";
  }
  return { id, params: Object.fromEntries(entries) };
}

/** Checks untrusted JSON is a recording within `LIMITS`; returns it, or a reason it isn't. */
export function parseRecording(json: unknown): Recording | string {
  if (typeof json !== "object" || json === null) return "not an object";
  const { v, events } = json as Partial<Recording>;
  const paper = parsePaper((json as { paper?: unknown }).paper);
  if (typeof paper === "string") return paper;
  const fold = (json as { fold?: unknown }).fold ?? DEFAULT_FOLD_METHOD;
  if (typeof fold !== "string" || !/^[a-z0-9-]{1,32}$/.test(fold)) return "bad fold method";
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
    if (k !== "cut" && k !== "recut") continue;
    const { tool, pts } = e as { tool: unknown; pts: unknown };
    if (typeof tool !== "string" || !Object.hasOwn(STRIDE, tool)) return "bad cut tool";
    const n = STRIDE[tool as CutKind];
    if (!Array.isArray(pts) || pts.length < n * 2 || pts.length % n) return "bad cut points";
    if (!pts.every((p) => typeof p === "number" && Number.isFinite(p) && Math.abs(p) < 1e7)) return "bad cut points";
    points += pts.length / n;
    if (points > LIMITS.points) return "too many points";
  }
  if (!events.some((e) => e.k === "cut")) return "nothing was cut";
  return { v: 1, fold, paper, events: events as TimelineEvent[] };
}

/** Collects events as they happen. */
export class Recorder {
  private start = performance.now();
  private offset = 0;
  events: TimelineEvent[] = [];
  paper: PaperChoice = DEFAULT_PAPER;
  fold = DEFAULT_FOLD_METHOD;

  /** Start a new sheet of paper, to be folded by `fold`. */
  reset(paper: PaperChoice = DEFAULT_PAPER, fold = DEFAULT_FOLD_METHOD) {
    this.paper = paper;
    this.fold = fold;
    this.events = [];
    this.offset = 0;
    this.start = performance.now();
  }

  /** Carry on from a saved recording, as though its story had just happened. */
  resume(r: Recording) {
    this.paper = r.paper;
    this.fold = r.fold;
    this.events = [...r.events];
    this.offset = (r.events[r.events.length - 1]?.t ?? 0) + 1000;
    this.start = performance.now();
  }

  now() {
    return Math.round(this.offset + performance.now() - this.start);
  }

  add(e: Step) {
    this.events.push({ t: this.now(), ...e } as TimelineEvent);
  }

  get recording(): Recording {
    return { v: 1, fold: this.fold, paper: this.paper, events: this.events };
  }
}
