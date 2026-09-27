// The paper's cut-out mask: a canvas over the flat square, white where there
// is paper and black where scissors took it away. Every one of the 16 sectors
// samples it at its own place in the flat square, so a hole shows through all
// the folded layers at once, and appears 16 times when the paper opens.
import * as THREE from "three";
import { SECTORS, invert, type Vec2 } from "./folds";

export const MASK_SIZE = 2048;

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
    this.texture.needsUpdate = true;
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
    for (const c of this.cuts) this.paint(c);
    this.texture.needsUpdate = true;
  }

  /**
   * The outline is drawn on the folded wedge. For each sector, carry it back
   * to where that sector lies in the flat square and cut only within it, so a
   * cut across a fold opens into the neighbouring sector as its mirror image.
   */
  private paint(outline: readonly Vec2[]) {
    const { ctx } = this;
    ctx.fillStyle = "#000";
    for (const s of SECTORS) {
      const [a, b, c, d] = invert(s.folded);
      ctx.save();
      toPixels(ctx);
      ctx.beginPath();
      for (const [x, y] of s.triangle) ctx.lineTo(x, y);
      ctx.closePath();
      ctx.clip();
      // Canvas transform(a, b, c, d, e, f) maps (x, y) to (ax + cy, bx + dy).
      ctx.transform(a, c, b, d, 0, 0);
      ctx.beginPath();
      for (const [x, y] of outline) ctx.lineTo(x, y);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }
}
