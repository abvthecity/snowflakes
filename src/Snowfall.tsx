// Soft snow drifting past in the background.
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";

const COUNT = 700;
const BOX = { x: 12, y: 8, zNear: -2, zFar: -9 };

function flakeSprite() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.4, "rgba(255,255,255,0.5)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/**
 * Each flake is a small square facing the viewer, one instance of one mesh.
 * (Sized points would be lighter, but WebGPU only draws them a pixel wide.)
 * The size matches what the old 0.06 attenuated point size came to on screen.
 */
const FLAKE = 0.022;

export function Snowfall() {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const { positions, speeds, sprite, matrix } = useMemo(() => {
    const positions = new Float32Array(COUNT * 3);
    const speeds = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) {
      positions[i * 3] = (Math.random() - 0.5) * BOX.x;
      positions[i * 3 + 1] = (Math.random() - 0.5) * BOX.y;
      positions[i * 3 + 2] = BOX.zNear + Math.random() * (BOX.zFar - BOX.zNear);
      speeds[i] = 0.15 + Math.random() * 0.35;
    }
    return { positions, speeds, sprite: flakeSprite(), matrix: new THREE.Matrix4() };
  }, []);

  useFrame(({ clock }, dt) => {
    const m = mesh.current;
    if (!m) return;
    const a = positions;
    const t = clock.elapsedTime;
    for (let i = 0; i < COUNT; i++) {
      a[i * 3 + 1] -= speeds[i] * dt;
      a[i * 3] += Math.sin(t * 0.5 + i) * 0.04 * dt;
      if (a[i * 3 + 1] < -BOX.y / 2) a[i * 3 + 1] += BOX.y;
      m.setMatrixAt(i, matrix.makeTranslation(a[i * 3], a[i * 3 + 1], a[i * 3 + 2]));
    }
    m.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, COUNT]} frustumCulled={false}>
      <planeGeometry args={[FLAKE, FLAKE]} />
      <meshBasicMaterial map={sprite} transparent opacity={0.7} depthWrite={false} color="#dfe9ff" />
    </instancedMesh>
  );
}
