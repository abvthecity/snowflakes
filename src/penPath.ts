// Outlines for the pen tools. A path is a list of anchors; each carries the
// offset of its outgoing handle, mirrored for the incoming one, the way a
// drawing app's pen tool works. A click leaves the handle at zero, which
// makes a straight segment; a press and drag pulls the handle out into a curve.
import type { Vec2 } from "./folds";

export interface Anchor {
  point: Vec2;
  /** Outgoing handle, relative to the point. The incoming handle is its mirror. */
  handle: Vec2;
  /** When it was placed (`performance.now()`), for the recording. */
  at?: number;
}

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
