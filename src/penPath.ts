// Cut shapes. A path is a list of anchors; each carries the offset of its
// outgoing handle, mirrored for the incoming one, the way a drawing app's pen
// tool works. A handle of zero makes a sharp corner and straight segments on
// either side; a handle pulled out makes a smooth curve through the point.
//
// Taps with the scissors drop corners. A freehand drag is fitted with a few
// such anchors when the finger lifts (`fitStroke`), so every cut, however it
// was drawn, is the same kind of path and can be reshaped the same way.
import type { Vec2 } from "./folds";

export interface Anchor {
  point: Vec2;
  /** Outgoing handle, relative to the point. The incoming handle is its mirror. */
  handle: Vec2;
  /** When it was placed (`performance.now()`), for the recording. */
  at?: number;
}

const dist = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Points along the cubic Bézier from anchor a to anchor b, excluding b itself. */
function segment(a: Anchor, b: Anchor, steps: number): Vec2[] {
  const p0 = a.point;
  const p1: Vec2 = [a.point[0] + a.handle[0], a.point[1] + a.handle[1]];
  const p2: Vec2 = [b.point[0] - b.handle[0], b.point[1] - b.handle[1]];
  const p3 = b.point;
  const straight = !a.handle[0] && !a.handle[1] && !b.handle[0] && !b.handle[1];
  if (straight) return [p0];
  return Array.from({ length: steps }, (_, i) => {
    const t = i / steps;
    const u = 1 - t;
    const w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
    return [
      w[0] * p0[0] + w[1] * p1[0] + w[2] * p2[0] + w[3] * p3[0],
      w[0] * p0[1] + w[1] * p1[1] + w[2] * p2[1] + w[3] * p3[1],
    ] as Vec2;
  });
}

/** The path as a polyline. `closed` adds the segment from the last anchor back to the first. */
export function outline(anchors: readonly Anchor[], closed: boolean, steps = 24): Vec2[] {
  if (anchors.length === 0) return [];
  const points: Vec2[] = [];
  for (let i = 0; i < anchors.length - 1; i++) points.push(...segment(anchors[i], anchors[i + 1], steps));
  if (closed && anchors.length > 2) points.push(...segment(anchors[anchors.length - 1], anchors[0], steps));
  else points.push(anchors[anchors.length - 1].point);
  return points;
}

/**
 * A smooth handle for `p` between its neighbours: along the line from the one
 * before to the one after, a third of the way to the nearer of them, so the
 * curve never overshoots a short side. With one neighbour it points along it.
 */
export function smoothHandle(prev: Vec2 | undefined, p: Vec2, next: Vec2 | undefined): Vec2 {
  const a = prev ?? p;
  const b = next ?? p;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (!len) return [0, 0];
  const sides = [prev, next].filter((q): q is Vec2 => !!q).map((q) => dist(p, q));
  const k = Math.min(...sides) / 3 / len;
  return [dx * k, dy * k];
}

/** Whether an anchor has a handle, i.e. makes a curve rather than a corner. */
export const isSmooth = (a: Anchor) => a.handle[0] !== 0 || a.handle[1] !== 0;

/** Turns a corner into a smooth point, or a smooth point back into a corner. */
export function toggleSmooth(anchors: readonly Anchor[], i: number, closed: boolean): Anchor[] {
  const n = anchors.length;
  const a = anchors[i];
  const at = (j: number) => (closed ? anchors[(j + n) % n] : anchors[j])?.point;
  const handle: Vec2 = isSmooth(a) ? [0, 0] : smoothHandle(at(i - 1), a.point, at(i + 1));
  return anchors.map((b, j) => (j === i ? { ...b, handle } : b));
}

/** Indices of the points Ramer–Douglas–Peucker keeps: within `eps` of the stroke everywhere. */
function simplify(points: readonly Vec2[], eps: number): number[] {
  const keep = new Set([0, points.length - 1]);
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop()!;
    let worst = -1;
    let far = eps;
    for (let k = i + 1; k < j; k++) {
      const d = toSegment(points[k], points[i], points[j]);
      if (d > far) {
        far = d;
        worst = k;
      }
    }
    if (worst < 0) continue;
    keep.add(worst);
    stack.push([i, worst], [worst, j]);
  }
  return [...keep].sort((a, b) => a - b);
}

function toSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

/** How far the stroke strays from the polyline, at its worst. */
function deviation(stroke: readonly Vec2[], line: readonly Vec2[]): number {
  let worst = 0;
  for (const p of stroke) {
    let best = Infinity;
    for (let i = 1; i < line.length; i++) best = Math.min(best, toSegment(p, line[i - 1], line[i]));
    worst = Math.max(worst, best);
  }
  return worst;
}

/** Points where the stroke turns by more than this stay sharp corners. */
const CORNER_TURN = (70 * Math.PI) / 180;

function turn(a: Vec2, p: Vec2, b: Vec2): number {
  const u = Math.atan2(p[1] - a[1], p[0] - a[0]);
  const v = Math.atan2(b[1] - p[1], b[0] - p[0]);
  const d = Math.abs(v - u) % (2 * Math.PI);
  return d > Math.PI ? 2 * Math.PI - d : d;
}

/** Evens out the tremor of a hand: each point moves toward its neighbours, twice. The ends of an open stroke stay put. */
function steady(stroke: readonly Vec2[], closed: boolean): Vec2[] {
  let pts = stroke.slice();
  const n = pts.length;
  for (let pass = 0; pass < 2; pass++) {
    pts = pts.map((p, i) => {
      if (!closed && (i === 0 || i === n - 1)) return p;
      const a = pts[(i - 1 + n) % n];
      const b = pts[(i + 1) % n];
      return [(a[0] + 2 * p[0] + b[0]) / 4, (a[1] + 2 * p[1] + b[1]) / 4] as Vec2;
    });
  }
  return pts;
}

/**
 * Fits a freehand stroke with as few anchors as keep the curve within
 * `tolerance` of it, so a shaky hand still gives a clean edge. Where the stroke
 * turns sharply the anchor stays a corner; elsewhere it gets a smooth handle.
 * A `closed` stroke loops back to its start; an open one ends in corners.
 */
export function fitStroke(stroke: readonly Vec2[], closed: boolean, tolerance: number): Anchor[] {
  if (stroke.length < 2) return stroke.map((point) => ({ point, handle: [0, 0] }));
  const smooth = steady(stroke, closed);
  const loop = closed ? [...smooth, smooth[0]] : smooth;
  let eps = tolerance * 2.5;
  let best: Anchor[] = [];
  for (let tries = 0; tries < 8; tries++) {
    const keys = simplify(loop, eps).map((i) => loop[i]);
    if (closed) keys.pop();
    const n = keys.length;
    const at = (j: number) => (closed ? keys[(j + n) % n] : keys[j]);
    best = keys.map((point, i) => {
      const prev = at(i - 1);
      const next = at(i + 1);
      const corner = !prev || !next || n < 3 || turn(prev, point, next) > CORNER_TURN;
      return { point, handle: corner ? [0, 0] : smoothHandle(prev, point, next) };
    });
    if (deviation(smooth, outline(best, closed, 12)) <= tolerance) break;
    eps *= 0.6;
  }
  return best;
}
