// The sheet itself: 16 triangular sectors that turn about the fold lines.
// `fold` runs from 0 (flat) to 4 (folded four times); fold i is part-way done
// while `fold` is between i and i + 1.
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type RefObject } from "react";
import * as THREE from "three";
import { FOLD_ANGLES, FOLD_LIFT, SECTORS } from "./folds";
import { webgpu } from "./gpu";
import { createPaperMaterial } from "./paperMaterial";

/** How far apart the stacked layers sit, in paper widths. */
const THICKNESS = 0.0035;
/**
 * Paper that has been folded never lies quite flat again. Once opened, the
 * crease lines ride alternately up and down by this much per unit of
 * distance from the centre, so each sector catches the light at its own angle.
 */
const CREASE_RISE = 0.045;

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

const AXES = FOLD_ANGLES.map((a) => new THREE.Vector3(Math.cos(a), Math.sin(a), 0));

function sectorGeometry(triangle: readonly (readonly [number, number])[]) {
  const g = new THREE.BufferGeometry();
  const pos = triangle.flatMap(([x, y]) => [x, y, 0]);
  const uv = triangle.flatMap(([x, y]) => [(x + 1) / 2, (y + 1) / 2]);
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

export function Paper({
  fold,
  mask,
  creased,
  colour,
}: {
  fold: RefObject<number>;
  mask: THREE.Texture;
  creased: boolean;
  /** The sheet's colour, an sRGB hex (see paperColours.ts). */
  colour: string;
}) {
  const material = useMemo(() => webgpu()?.createPaperNodeMaterial(mask) ?? createPaperMaterial(mask), [mask]);
  useEffect(() => {
    if ("tint" in material) material.tint.value.set(colour);
    else material.color.set(colour);
  }, [material, colour]);
  const geometries = useMemo(() => SECTORS.map((s) => sectorGeometry(s.triangle)), []);
  const meshes = useRef<(THREE.Mesh | null)[]>([]);

  const scratch = useMemo(() => ({ m: new THREE.Matrix4(), r: new THREE.Matrix4() }), []);
  const crease = useRef(0);

  useFrame((_, dt) => {
    const f = fold.current;
    crease.current = THREE.MathUtils.damp(crease.current, creased ? 1 : 0, 3, dt);
    // The WebGPU paper draws the crease lines themselves, as the sheet opens.
    if ("crease" in material) material.crease.value = crease.current * (1 - clamp01(f));
    for (const s of SECTORS) {
      const mesh = meshes.current[s.index];
      if (!mesh) continue;
      const { m, r } = scratch;
      m.identity();
      let layer = 0;
      for (let i = 0; i < FOLD_ANGLES.length; i++) {
        const p = ease(clamp01(f - i));
        if (s.moves[i] && p > 0) m.premultiply(r.makeRotationAxis(AXES[i], FOLD_LIFT[i] * Math.PI * p));
        if (p > 0) layer = THREE.MathUtils.lerp(s.layers[i], s.layers[i + 1], p);
      }
      m.elements[14] += layer * THICKNESS;

      // Ridge the creases while the paper is (nearly) open. Neighbouring
      // sectors share the crease between them, so the sheet stays whole.
      const rise = CREASE_RISE * crease.current * (1 - clamp01(f));
      const pos = mesh.geometry.attributes.position as THREE.BufferAttribute;
      const [, a, b] = s.triangle;
      const sign = s.index % 2 ? 1 : -1;
      pos.setZ(1, sign * rise * Math.hypot(a[0], a[1]));
      pos.setZ(2, -sign * rise * Math.hypot(b[0], b[1]));
      pos.needsUpdate = true;
      mesh.geometry.computeVertexNormals();
      mesh.matrix.copy(m);
      mesh.matrixWorldNeedsUpdate = true;
    }
  });

  return (
    <group>
      {SECTORS.map((s) => (
        <mesh
          key={s.index}
          ref={(el) => {
            meshes.current[s.index] = el;
          }}
          geometry={geometries[s.index]}
          material={material}
          matrixAutoUpdate={false}
          castShadow
          receiveShadow
        />
      ))}
    </group>
  );
}
