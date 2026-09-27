// The piece a cut in progress would take away, faded, so you can see what
// will be left before you close the shape. It is a veil over the folded
// wedge, painted on a small canvas with the same fill rule as the real cut,
// clipped to the paper and with earlier holes left clear.
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { TRIM_LINE, type Vec2 } from "./folds";

/** The canvas covers this part of the wedge's plane, [x0, y0, x1, y1]. */
const AREA = [-0.3, -0.02, 0.3, 1.0] as const;
const PER_UNIT = 900;
const W = Math.round((AREA[2] - AREA[0]) * PER_UNIT);
const H = Math.round((AREA[3] - AREA[1]) * PER_UNIT);
/** The folded, trimmed paper: the centre and the two ends of the trim. */
const PAPER: readonly Vec2[] = [[0, 0], TRIM_LINE[1], TRIM_LINE[0]];

function trace(ctx: CanvasRenderingContext2D, points: readonly Vec2[]) {
  ctx.beginPath();
  for (const [x, y] of points) ctx.lineTo(x, y);
  ctx.closePath();
}

export function CutPreview({ shape, holes, z }: { shape: readonly Vec2[]; holes: readonly (readonly Vec2[])[]; z: number }) {
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
    ctx.fillStyle = "rgba(24, 33, 70, 0.62)";
    trace(ctx, shape);
    ctx.fill();
    ctx.globalCompositeOperation = "destination-out";
    for (const h of holes) {
      trace(ctx, h);
      ctx.fill();
    }
    ctx.restore();
    texture.needsUpdate = true;
  }, [ctx, texture, shape, holes, visible]);

  return (
    <mesh visible={visible} position={[(AREA[0] + AREA[2]) / 2, (AREA[1] + AREA[3]) / 2, z]}>
      <planeGeometry args={[AREA[2] - AREA[0], AREA[3] - AREA[1]]} />
      <meshBasicMaterial map={texture} transparent depthWrite={false} toneMapped={false} />
    </mesh>
  );
}
