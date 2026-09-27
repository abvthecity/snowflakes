// A flat line of fixed on-screen width, drawn as a ribbon of quads in the
// paper's plane. It stands in for drei's <Line>, whose shader material only
// runs on WebGL, so the guides draw the same on either renderer.
import { useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";

type Point = readonly [number, number, number];

export function Stroke({
  points,
  color,
  lineWidth,
  dashed = false,
  dashSize = 0.02,
  gapSize = 0.012,
}: {
  points: readonly Point[];
  color: string;
  /** Width in CSS pixels, at the distance of the line's first point. */
  lineWidth: number;
  dashed?: boolean;
  dashSize?: number;
  gapSize?: number;
}) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const height = useThree((s) => s.size.height);
  const distance = points.length ? camera.position.distanceTo(new THREE.Vector3(...points[0])) : 1;
  const half = (lineWidth / 2) * ((2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / height);

  const geometry = useMemo(() => {
    const pos: number[] = [];
    const quad = (a: Point, b: Point) => {
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const len = Math.hypot(dx, dy) || 1;
      // Overlap each quad slightly past its ends so corners don't gap.
      const ex = (dx / len) * half;
      const ey = (dy / len) * half;
      const nx = -ey;
      const ny = ex;
      const p0 = [a[0] - ex + nx, a[1] - ey + ny, a[2]];
      const p1 = [a[0] - ex - nx, a[1] - ey - ny, a[2]];
      const p2 = [b[0] + ex - nx, b[1] + ey - ny, b[2]];
      const p3 = [b[0] + ex + nx, b[1] + ey + ny, b[2]];
      pos.push(...p0, ...p1, ...p2, ...p0, ...p2, ...p3);
    };
    let along = 0;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      if (!dashed) {
        quad(a, b);
        continue;
      }
      // Walk the segment in dash and gap steps, carrying the phase across corners.
      const period = dashSize + gapSize;
      let t = 0;
      while (t < len) {
        const phase = (along + t) % period;
        const inDash = phase < dashSize;
        const step = Math.min(len - t, inDash ? dashSize - phase : period - phase);
        if (inDash && step > 1e-6) {
          const at = (s: number): Point => [
            a[0] + ((b[0] - a[0]) * s) / len,
            a[1] + ((b[1] - a[1]) * s) / len,
            a[2] + ((b[2] - a[2]) * s) / len,
          ];
          quad(at(t), at(t + step));
        }
        t += Math.max(step, 1e-6);
      }
      along += len;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    return g;
  }, [points, half, dashed, dashSize, gapSize]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <mesh geometry={geometry} renderOrder={1}>
      <meshBasicMaterial color={color} toneMapped={false} side={THREE.DoubleSide} />
    </mesh>
  );
}
