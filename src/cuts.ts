// The paper's cut-out mask: a canvas over the flat square, white where there
// is paper and black where scissors took it away. Every one of the 12 sectors
// samples it at its own place in the flat square, so a hole shows through all
// the folded layers at once, and appears 12 times when the paper opens.
import * as THREE from "three";
import { DEFAULT_METHOD, invert, type FoldMethod, type Vec2 } from "./folds";
import { Pieces, drawScraps } from "./pieces";

export const MASK_SIZE = 2048;
/** Resolution of the raster that finds severed pieces: about the mask's. */
const SCRAP_PER_UNIT = MASK_SIZE / 2;

/** Flat-square coordinates ([-1, 1]², y up) to mask pixels (y down). */
function toPixels(ctx: CanvasRenderingContext2D) {
  const half = MASK_SIZE / 2;
  ctx.setTransform(half, 0, 0, -half, half, half);
}

export class CutMask {
  readonly canvas: HTMLCanvasElement;
  readonly texture: THREE.CanvasTexture;
  private readonly ctx: CanvasRenderingContext2D;
  private cuts: Vec2[][] = [];
  private trimmed: readonly Vec2[] | null = null;
  private method: FoldMethod = DEFAULT_METHOD;
  private scrap: HTMLCanvasElement | null = null;
  private pieces = new Pieces(SCRAP_PER_UNIT);
  /** Goes up on every change, for views that follow the cuts. */
  version = 0;

  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.width = this.canvas.height = MASK_SIZE;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas unavailable");
    this.ctx = ctx;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.NoColorSpace;
    this.texture.anisotropy = 8;
    this.redraw();
  }

  get count() {
    return this.cuts.length;
  }

  /** The cuts on the paper, oldest first, as outlines on the folded wedge. */
  get outlines(): readonly (readonly Vec2[])[] {
    return this.cuts;
  }

  /** Pieces the cuts have severed, and so tossed: see pieces.ts. Null when the paper is in one piece. */
  get scraps(): { canvas: HTMLCanvasElement; perUnit: number } | null {
    return this.scrap && { canvas: this.scrap, perUnit: SCRAP_PER_UNIT };
  }

  get isTrimmed() {
    return this.trimmed !== null;
  }

  /** Slice the top off the folded paper. Kept apart from the cuts, so Undo never brings it back. */
  trim(outline: readonly Vec2[]) {
    if (this.trimmed) return;
    this.trimmed = outline;
    this.paint(outline);
    this.texture.needsUpdate = true;
  }

  /** Cut along a closed outline drawn over the folded paper. */
  cut(outline: Vec2[]) {
    if (outline.length < 3) return;
    this.cuts.push(outline);
    this.paint(outline);
    this.pieces.cut(outline);
    this.toss();
    this.version++;
    this.texture.needsUpdate = true;
  }

  /** Fold the paper another way. The cuts are drawn on the folded paper, so they follow it. */
  setMethod(method: FoldMethod) {
    if (method === this.method) return;
    this.method = method;
    this.redraw();
  }

  undo() {
    this.cuts.pop();
    this.redraw();
  }

  clear() {
    this.cuts = [];
    this.trimmed = null;
    this.redraw();
  }

  private redraw() {
    const { ctx } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, MASK_SIZE, MASK_SIZE);
    if (this.trimmed) this.paint(this.trimmed);
    this.pieces.reset();
    for (const c of this.cuts) {
      this.paint(c);
      this.pieces.cut(c);
    }
    this.toss();
    this.version++;
    this.texture.needsUpdate = true;
  }

  /** Cut away every piece that no longer hangs on to the snowflake. */
  private toss() {
    this.scrap = this.pieces.scraps();
    const scrap = this.scrap;
    if (scrap) this.paint((ctx) => drawScraps(ctx, scrap, SCRAP_PER_UNIT));
  }

  /**
   * The outline is drawn on the folded wedge. For each sector, carry it back
   * to where that sector lies in the flat square and cut only within it, so a
   * cut across a fold opens into the neighbouring sector as its mirror image.
   */
  private paint(shape: readonly Vec2[] | ((ctx: CanvasRenderingContext2D) => void)) {
    const { ctx } = this;
    ctx.fillStyle = "#000";
    for (const s of this.method.sectors) {
      const [a, b, c, d] = invert(s.folded);
      ctx.save();
      toPixels(ctx);
      ctx.beginPath();
      for (const [x, y] of s.outline) ctx.lineTo(x, y);
      ctx.closePath();
      ctx.clip();
      // Canvas transform(a, b, c, d, e, f) maps (x, y) to (ax + cy, bx + dy).
      ctx.transform(a, c, b, d, 0, 0);
      if (typeof shape === "function") shape(ctx);
      else {
        ctx.beginPath();
        for (const [x, y] of shape) ctx.lineTo(x, y);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }
  }
}
