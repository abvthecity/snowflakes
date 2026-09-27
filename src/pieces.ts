// A cut that runs right across the folded wedge severs it: the unfolded paper
// falls into pieces, and only one of them is the snowflake. Each piece of the
// wedge only joins on to its own mirror images across the folds, so the
// wedge's pieces are the paper's pieces. We keep the one nearest the centre
// and toss the rest, as the scraps that fall to the table.
//
// The pieces are found on a raster of the wedge: the paper white, the cuts
// black, and a flood fill to tell the pieces apart.
import { TRIM_LINE, type Vec2 } from "./folds.ts";

/** The raster covers this part of the wedge's plane, [x0, y0, x1, y1]. */
export const WEDGE_AREA = [-0.3, -0.02, 0.3, 1.0] as const;
/** The folded, trimmed paper: the centre and the two ends of the trim. */
export const WEDGE_PAPER: readonly Vec2[] = [[0, 0], TRIM_LINE[1], TRIM_LINE[0]];

/**
 * Given which pixels of a w × h grid are paper, marks every paper pixel that
 * is not in the piece nearest pixel (cx, cy), then grows the marks by `grow`
 * pixels so they cover the edges they share with cuts.
 */
export function strays(paper: Uint8Array, w: number, h: number, cx: number, cy: number, grow = 0): Uint8Array {
  const label = new Int32Array(w * h).fill(-1);
  const stack: number[] = [];
  let pieces = 0;
  let keep = -1;
  let nearest = Infinity;
  for (let start = 0; start < w * h; start++) {
    if (!paper[start] || label[start] >= 0) continue;
    const id = pieces++;
    label[start] = id;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % w;
      const y = (i - x) / w;
      const d = (x - cx) ** 2 + (y - cy) ** 2;
      if (d < nearest) {
        nearest = d;
        keep = id;
      }
      if (x > 0 && paper[i - 1] && label[i - 1] < 0) (label[i - 1] = id), stack.push(i - 1);
      if (x < w - 1 && paper[i + 1] && label[i + 1] < 0) (label[i + 1] = id), stack.push(i + 1);
      if (y > 0 && paper[i - w] && label[i - w] < 0) (label[i - w] = id), stack.push(i - w);
      if (y < h - 1 && paper[i + w] && label[i + w] < 0) (label[i + w] = id), stack.push(i + w);
    }
  }
  let out = new Uint8Array(w * h);
  if (pieces < 2) return out;
  for (let i = 0; i < w * h; i++) if (label[i] >= 0 && label[i] !== keep) out[i] = 1;
  for (let g = 0; g < grow; g++) {
    const next = out.slice();
    for (let i = 0; i < w * h; i++) {
      if (out[i] || label[i] === keep) continue;
      const x = i % w;
      if ((x > 0 && out[i - 1]) || (x < w - 1 && out[i + 1]) || out[i - w] || out[i + w]) next[i] = 1;
    }
    out = next;
  }
  return out;
}

function trace(ctx: CanvasRenderingContext2D, points: readonly Vec2[]) {
  ctx.beginPath();
  for (const [x, y] of points) ctx.lineTo(x, y);
  ctx.closePath();
}

/**
 * The pieces the cuts sever from the snowflake, drawn opaque on a canvas over
 * WEDGE_AREA at `perUnit` pixels per paper unit, or null when the paper is
 * still in one piece.
 */
export function scraps(cuts: readonly (readonly Vec2[])[], perUnit: number): HTMLCanvasElement | null {
  const [x0, y0, x1, y1] = WEDGE_AREA;
  const w = Math.round((x1 - x0) * perUnit);
  const h = Math.round((y1 - y0) * perUnit);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.setTransform(perUnit, 0, 0, -perUnit, -x0 * perUnit, y1 * perUnit);
  ctx.fillStyle = "#fff";
  trace(ctx, WEDGE_PAPER);
  ctx.fill();
  ctx.fillStyle = "#000";
  for (const c of cuts) {
    trace(ctx, c);
    ctx.fill();
  }
  const img = ctx.getImageData(0, 0, w, h);
  const paper = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) paper[i] = img.data[i * 4] > 127 ? 1 : 0;
  const lost = strays(paper, w, h, -x0 * perUnit, y1 * perUnit, 2);
  if (!lost.some(Boolean)) return null;
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    img.data[o] = img.data[o + 1] = img.data[o + 2] = 0;
    img.data[o + 3] = lost[i] ? 255 : 0;
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** Draws a scraps canvas in wedge coordinates, under whatever transform `ctx` has. */
export function drawScraps(ctx: CanvasRenderingContext2D, scrap: HTMLCanvasElement, perUnit: number) {
  ctx.save();
  ctx.transform(1 / perUnit, 0, 0, -1 / perUnit, WEDGE_AREA[0], WEDGE_AREA[3]);
  ctx.drawImage(scrap, 0, 0);
  ctx.restore();
}
