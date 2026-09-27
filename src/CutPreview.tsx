// The piece a cut in progress would take away, faded, so you can see what
// will be left before you close the shape: the shape itself, and any piece of
// paper it would sever from the snowflake (pieces.ts). It is a veil over the
// folded wedge, painted on a small canvas with the same fill rule as the real
// cut, clipped to the paper and with earlier holes left clear.
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { CutMask } from "./cuts";
import type { Vec2 } from "./folds";
import { WEDGE_AREA as AREA, WEDGE_PAPER as PAPER, drawScraps, scraps } from "./pieces";

const PER_UNIT = 900;
/** Finding severed pieces runs on every move, so on a coarser raster. */
const SCRAP_PER_UNIT = 300;
const W = Math.round((AREA[2] - AREA[0]) * PER_UNIT);
const H = Math.round((AREA[3] - AREA[1]) * PER_UNIT);

function trace(ctx: CanvasRenderingContext2D, points: readonly Vec2[]) {
  ctx.beginPath();
  for (const [x, y] of points) ctx.lineTo(x, y);
  ctx.closePath();
}

export function CutPreview({ shape, mask, z }: { shape: readonly Vec2[]; mask: CutMask; z: number }) {
  const { ctx, texture } = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return { ctx: canvas.getContext("2d")!, texture };
  }, []);
  useEffect(() => () => texture.dispose(), [texture]);

  const visible = shape.length > 2;
  useEffect(() => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (!visible) return;
    // Plane coordinates to pixels, y up.
    ctx.setTransform(PER_UNIT, 0, 0, -PER_UNIT, -AREA[0] * PER_UNIT, AREA[3] * PER_UNIT);
    ctx.save();
    trace(ctx, PAPER);
    ctx.clip();
    // Everything that would go, opaque, then tinted to one even veil.
    ctx.fillStyle = "#000";
    trace(ctx, shape);
    ctx.fill();
    const severed = scraps([...mask.outlines, shape], SCRAP_PER_UNIT);
    if (severed) drawScraps(ctx, severed, SCRAP_PER_UNIT);
    ctx.globalCompositeOperation = "source-in";
    ctx.fillStyle = "rgba(24, 33, 70, 0.62)";
    ctx.fillRect(AREA[0], AREA[1], AREA[2] - AREA[0], AREA[3] - AREA[1]);
    // Leave what is already gone clear.
    ctx.globalCompositeOperation = "destination-out";
    for (const h of mask.outlines) {
      trace(ctx, h);
      ctx.fill();
    }
    const gone = mask.scraps;
    if (gone) drawScraps(ctx, gone.canvas, gone.perUnit);
    ctx.restore();
    texture.needsUpdate = true;
  }, [ctx, texture, shape, mask, visible]);

  return (
    <mesh visible={visible} position={[(AREA[0] + AREA[2]) / 2, (AREA[1] + AREA[3]) / 2, z]}>
      <planeGeometry args={[AREA[2] - AREA[0], AREA[3] - AREA[1]]} />
      <meshBasicMaterial map={texture} transparent depthWrite={false} toneMapped={false} />
    </mesh>
  );
}
