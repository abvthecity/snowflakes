// A cut that runs right across the folded wedge severs it: the unfolded paper
// falls into pieces, and only one of them is the snowflake. Each piece of the
// wedge only joins on to its own mirror images across the folds, so the
// wedge's pieces are the paper's pieces.
//
// Which piece stays depends on where the cut took its paper from. Cut in the
// outer half, it slices a piece off the edge, so the outer piece goes. Cut in
// the inner half, it is a hole in the middle, so the centre piece goes. Where
// the cut sits is the middle of the paper it removed (its centroid), as a
// fraction of the way from the centre out to the trimmed edge.
//
// The pieces are found on a raster of the wedge: the paper set, the cuts
// clear, and a flood fill to tell the pieces apart.
import { TRIM_LINE, type Vec2 } from "./folds.ts";

/** The raster covers this part of the wedge's plane, [x0, y0, x1, y1]. */
export const WEDGE_AREA = [-0.3, -0.02, 0.3, 1.0] as const;
/** The folded, trimmed paper: the centre and the two ends of the trim. */
export const WEDGE_PAPER: readonly Vec2[] = [[0, 0], TRIM_LINE[1], TRIM_LINE[0]];

/** How far from the centre the trimmed edge is, going in direction (dx, dy). */
export function edgeDistance(dx: number, dy: number): number {
  const [a, b] = TRIM_LINE;
  // Solve t·d = a + s·(b − a) for t, with d a unit vector.
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const ex = b[0] - a[0];
  const ey = b[1] - a[1];
  const det = ux * -ey - uy * -ex;
  if (Math.abs(det) < 1e-12) return Math.hypot(a[0], a[1]);
  return (a[0] * -ey - a[1] * -ex) / det;
}

/**
 * Cuts the `cut` pixels out of `paper` (a w × h grid, 1 where there is paper)
 * and, if what is left falls apart, keeps one piece by the rule above. The
 * centre is at pixel (cx, cy); `edge(dx, dy)` is how many pixels it is to the
 * trimmed edge in that direction. Returns the paper left.
 */
export function cutPaper(
  paper: Uint8Array,
  cut: Uint8Array,
  w: number,
  h: number,
  cx: number,
  cy: number,
  edge: (dx: number, dy: number) => number,
): Uint8Array {
  const left = new Uint8Array(w * h);
  let removed = 0;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < w * h; i++) {
    if (!paper[i]) continue;
    if (cut[i]) {
      removed++;
      sx += i % w;
      sy += Math.floor(i / w);
    } else left[i] = 1;
  }
  if (!removed) return left;

  const label = new Int32Array(w * h).fill(-1);
  const sizes: number[] = [];
  const nearness: number[] = [];
  const stack: number[] = [];
  for (let start = 0; start < w * h; start++) {
    if (!left[start] || label[start] >= 0) continue;
    const id = sizes.length;
    sizes.push(0);
    nearness.push(Infinity);
    label[start] = id;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % w;
      const y = (i - x) / w;
      sizes[id]++;
      nearness[id] = Math.min(nearness[id], (x - cx) ** 2 + (y - cy) ** 2);
      if (x > 0 && left[i - 1] && label[i - 1] < 0) (label[i - 1] = id), stack.push(i - 1);
      if (x < w - 1 && left[i + 1] && label[i + 1] < 0) (label[i + 1] = id), stack.push(i + 1);
      if (y > 0 && left[i - w] && label[i - w] < 0) (label[i - w] = id), stack.push(i - w);
      if (y < h - 1 && left[i + w] && label[i + w] < 0) (label[i + w] = id), stack.push(i + w);
    }
  }
  if (sizes.length < 2) return left;

  const centre = nearness.indexOf(Math.min(...nearness));
  const dx = sx / removed - cx;
  const dy = sy / removed - cy;
  const inner = Math.hypot(dx, dy) < 0.5 * edge(dx, dy);
  let keep = centre;
  if (inner) {
    // A hole in the middle: the centre goes, and the biggest of the rest stays.
    let biggest = -1;
    sizes.forEach((n, id) => {
      if (id !== centre && (biggest < 0 || n > sizes[biggest])) biggest = id;
    });
    keep = biggest;
  }
  for (let i = 0; i < w * h; i++) left[i] = label[i] === keep ? 1 : 0;
  return left;
}

function trace(ctx: CanvasRenderingContext2D, points: readonly Vec2[]) {
  ctx.beginPath();
  for (const [x, y] of points) ctx.lineTo(x, y);
  ctx.closePath();
}

/**
 * The wedge's paper as a raster at `perUnit` pixels per paper unit, cut by
 * cut, keeping track of the pieces each cut tosses.
 */
export class Pieces {
  readonly w: number;
  readonly h: number;
  readonly perUnit: number;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly cx: number;
  private readonly cy: number;
  private readonly edge: (dx: number, dy: number) => number;
  /** 1 where the wedge has paper before any cut. */
  private readonly sheet: Uint8Array;
  /** 1 where there is still paper. */
  private paper: Uint8Array;
  /** 1 where a cut went. */
  private holes: Uint8Array;

  constructor(perUnit: number) {
    this.perUnit = perUnit;
    const [x0, y0, x1, y1] = WEDGE_AREA;
    this.w = Math.round((x1 - x0) * perUnit);
    this.h = Math.round((y1 - y0) * perUnit);
    const canvas = document.createElement("canvas");
    canvas.width = this.w;
    canvas.height = this.h;
    this.ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    this.cx = -x0 * perUnit;
    this.cy = y1 * perUnit;
    // Pixels are y-down, so flip dy back before asking the geometry.
    this.edge = (dx, dy) => edgeDistance(dx, -dy) * perUnit;
    this.sheet = this.raster(WEDGE_PAPER);
    this.paper = this.sheet.slice();
    this.holes = new Uint8Array(this.w * this.h);
  }

  /** Back to uncut paper. */
  reset() {
    this.paper = this.sheet.slice();
    this.holes = new Uint8Array(this.w * this.h);
  }

  cut(outline: readonly Vec2[]) {
    const r = this.raster(outline);
    this.paper = cutPaper(this.paper, r, this.w, this.h, this.cx, this.cy, this.edge);
    for (let i = 0; i < r.length; i++) this.holes[i] |= r[i];
  }

  /** The pieces tossed so far, drawn opaque on a canvas over WEDGE_AREA, or null if none. */
  scraps(): HTMLCanvasElement | null {
    return this.draw(this.paper, this.holes);
  }

  /** What the scraps would be after cutting `outline` too, without cutting it. */
  scrapsAfter(outline: readonly Vec2[]): HTMLCanvasElement | null {
    const r = this.raster(outline);
    const paper = cutPaper(this.paper, r, this.w, this.h, this.cx, this.cy, this.edge);
    const holes = this.holes.slice();
    for (let i = 0; i < r.length; i++) holes[i] |= r[i];
    return this.draw(paper, holes);
  }

  /** 1 where the shape covers a pixel's centre, with the same fill rule as the mask. */
  private raster(shape: readonly Vec2[]): Uint8Array {
    const { ctx, w, h, perUnit } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.setTransform(perUnit, 0, 0, -perUnit, this.cx, this.cy);
    ctx.fillStyle = "#fff";
    trace(ctx, shape);
    ctx.fill();
    const data = ctx.getImageData(0, 0, w, h).data;
    const out = new Uint8Array(w * h);
    for (let i = 0; i < out.length; i++) out[i] = data[i * 4 + 3] > 127 ? 1 : 0;
    return out;
  }

  /**
   * Paper that is neither left nor cut was tossed. Grown by two pixels (never
   * into the paper left) so it covers the edges it shares with cuts and folds.
   */
  private draw(paper: Uint8Array, holes: Uint8Array): HTMLCanvasElement | null {
    const { w, h, sheet } = this;
    let lost = new Uint8Array(w * h);
    let any = false;
    for (let i = 0; i < lost.length; i++) {
      if (sheet[i] && !paper[i] && !holes[i]) lost[i] = 1;
      any ||= !!lost[i];
    }
    if (!any) return null;
    for (let g = 0; g < 2; g++) {
      const next = lost.slice();
      for (let i = 0; i < lost.length; i++) {
        if (lost[i] || paper[i]) continue;
        const x = i % w;
        if ((x > 0 && lost[i - 1]) || (x < w - 1 && lost[i + 1]) || lost[i - w] || lost[i + w]) next[i] = 1;
      }
      lost = next;
    }
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    const img = ctx.createImageData(w, h);
    for (let i = 0; i < lost.length; i++) img.data[i * 4 + 3] = lost[i] ? 255 : 0;
    ctx.putImageData(img, 0, 0);
    return canvas;
  }
}

/** Draws a scraps canvas in wedge coordinates, under whatever transform `ctx` has. */
export function drawScraps(ctx: CanvasRenderingContext2D, scrap: HTMLCanvasElement, perUnit: number) {
  ctx.save();
  ctx.transform(1 / perUnit, 0, 0, -1 / perUnit, WEDGE_AREA[0], WEDGE_AREA[3]);
  ctx.drawImage(scrap, 0, 0);
  ctx.restore();
}
