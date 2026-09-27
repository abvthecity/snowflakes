// The sheet itself: 12 sectors that turn about the fold lines.
// `fold` runs from 0 (flat) to 4 (folded four times); fold i is part-way done
// while `fold` is between i and i + 1.
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type RefObject } from "react";
import * as THREE from "three";
import type { FoldMethod, Vec2 } from "./folds";
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
/** Below this cosine between a layer and the line of sight, it counts as edge-on. */
const EDGE_ON = 0.4;

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

/** A fan of triangles out from the centre, which is the outline's first point. */
function sectorGeometry(outline: readonly Vec2[]) {
  const g = new THREE.BufferGeometry();
  const pos = outline.flatMap(([x, y]) => [x, y, 0]);
  const uv = outline.flatMap(([x, y]) => [(x + 1) / 2, (y + 1) / 2]);
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(outline.slice(2).flatMap((_, i) => [0, i + 1, i + 2]));
  g.computeVertexNormals();
  return g;
}

export function Paper({
  method,
  fold,
  mask,
  creased,
  colour,
}: {
  method: FoldMethod;
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
  const { foldAngles, lift, turn: cone } = method;
  const geometries = useMemo(() => method.sectors.map((s) => sectorGeometry(s.outline)), [method]);
  const axes = useMemo(() => foldAngles.map((a) => new THREE.Vector3(Math.cos(a), Math.sin(a), 0)), [foldAngles]);
  // Folded, the paper is up to twelve layers deep, and the full paper shader
  // on every one of them is what bogs a phone down. Layers buried under
  // the rest of the stack draw in plain paper instead: only a sliver of their
  // edge ever shows, and they draw after the top layers, so the GPU can skip
  // most of their pixels altogether.
  const buried = useMemo(
    () =>
      new THREE.MeshLambertMaterial({
        color: new THREE.Color("#fbfaf5"),
        alphaMap: mask,
        alphaTest: 0.5,
        alphaToCoverage: true,
        side: THREE.DoubleSide,
      }),
    [mask],
  );
  // Each sector is a pair of meshes, one in each material, and shows one of
  // them: swapping a mesh's material mid-flight upsets three's WebGPU renderer.
  const sectors = useRef<({ turn: THREE.Group; paper: THREE.Mesh; plain: THREE.Mesh } | null)[]>([]);
  const group = useRef<THREE.Group>(null);

  const scratch = useMemo(
    () => ({
      m: new THREE.Matrix4(),
      r: new THREE.Matrix4(),
      normal: new THREE.Vector3(),
      eye: new THREE.Vector3(),
      facing: new THREE.Vector3(),
    }),
    [],
  );
  const crease = useRef(0);

  useFrame(({ camera }, dt) => {
    const f = fold.current;
    const stage = Math.min(foldAngles.length, Math.floor(f));
    const cover = method.cover[stage];
    // Layers stack up along the sheet's own +z. From which side of the stack
    // does the camera look (as of the last frame)?
    const { normal, eye } = scratch;
    const sheet = group.current;
    let fromFront = true;
    if (sheet) {
      normal.setFromMatrixColumn(sheet.matrixWorld, 2);
      eye.setFromMatrixPosition(sheet.matrixWorld).sub(camera.position).normalize();
      fromFront = normal.dot(eye) < 0;
    }
    crease.current = THREE.MathUtils.damp(crease.current, creased ? 1 : 0, 3, dt);
    // The WebGPU paper draws the crease lines themselves, as the sheet opens.
    if ("crease" in material) material.crease.value = crease.current * (1 - clamp01(f));
    for (const s of method.sectors) {
      const sector = sectors.current[s.index];
      if (!sector) continue;
      const { turn, paper, plain } = sector;
      const { m, r } = scratch;
      m.identity();
      let layer = 0;
      for (let i = 0; i < foldAngles.length; i++) {
        const p = ease(clamp01(f - i));
        if (s.moves[i] && p > 0) m.premultiply(r.makeRotationAxis(axes[i], lift[i] * Math.PI * p));
        if (p > 0) layer = THREE.MathUtils.lerp(s.layers[i], s.layers[i + 1], p);
      }
      // The finished cone turns upright as the last fold closes it.
      if (cone) m.premultiply(r.makeRotationZ(cone * ease(clamp01(f - (foldAngles.length - 1)))));
      m.elements[14] += layer * THICKNESS;

      // Ridge the creases while the paper is (nearly) open. Neighbouring
      // sectors share the crease between them, so the sheet stays whole.
      const rise = CREASE_RISE * crease.current * (1 - clamp01(f));
      const pos = paper.geometry.attributes.position as THREE.BufferAttribute;
      s.outline.forEach(([x, y], k) => pos.setZ(k, rise * (s.ridge[0] * x + s.ridge[1] * y)));
      pos.needsUpdate = true;
      paper.geometry.computeVertexNormals();
      turn.matrix.copy(m);
      turn.matrixWorldNeedsUpdate = true;

      // Whether the side facing the camera lies under another layer. A flap
      // on its way over shows both sides, so it is buried only if covered on
      // both. Seen nearly edge-on, every layer's face shows as a strip, but
      // then the layers cover so few pixels that they may as well be paper.
      const { above, below } = cover[s.index];
      const turning = f > stage && s.moves[stage];
      const covered = turning ? above && below : fromFront ? above : below;
      const facing = Math.abs(scratch.facing.setFromMatrixColumn(turn.matrixWorld, 2).normalize().dot(eye));
      const hidden = covered && facing > EDGE_ON;
      paper.visible = !hidden;
      plain.visible = hidden;
    }
  });

  return (
    <group ref={group}>
      {method.sectors.map((s) => (
        <group
          key={s.index}
          ref={(turn) => {
            const [paper, plain] = (turn?.children ?? []) as THREE.Mesh[];
            sectors.current[s.index] = turn && paper && plain ? { turn, paper, plain } : null;
          }}
          matrixAutoUpdate={false}
        >
          <mesh geometry={geometries[s.index]} material={material} castShadow receiveShadow />
          <mesh geometry={geometries[s.index]} material={buried} visible={false} castShadow receiveShadow />
        </group>
      ))}
      {/* Too small to see, but it gets the plain paper compiled with the rest of the scene, before the first fold needs it. */}
      <mesh geometry={geometries[0]} material={buried} scale={1e-6} />
    </group>
  );
}
