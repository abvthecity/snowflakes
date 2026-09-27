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

export function Snowfall() {
  const points = useRef<THREE.Points>(null);
  const { geometry, speeds, sprite } = useMemo(() => {
    const pos = new Float32Array(COUNT * 3);
    const speeds = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) {
      pos[i * 3] = (Math.random() - 0.5) * BOX.x;
      pos[i * 3 + 1] = (Math.random() - 0.5) * BOX.y;
      pos[i * 3 + 2] = BOX.zNear + Math.random() * (BOX.zFar - BOX.zNear);
      speeds[i] = 0.15 + Math.random() * 0.35;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    return { geometry, speeds, sprite: flakeSprite() };
  }, []);

  useFrame(({ clock }, dt) => {
    const attr = geometry.attributes.position as THREE.BufferAttribute;
    const a = attr.array as Float32Array;
    const t = clock.elapsedTime;
    for (let i = 0; i < COUNT; i++) {
      a[i * 3 + 1] -= speeds[i] * dt;
      a[i * 3] += Math.sin(t * 0.5 + i) * 0.04 * dt;
      if (a[i * 3 + 1] < -BOX.y / 2) a[i * 3 + 1] += BOX.y;
    }
    attr.needsUpdate = true;
  });

  return (
    <points ref={points} geometry={geometry}>
      <pointsMaterial
        map={sprite}
        size={0.06}
        sizeAttenuation
        transparent
        opacity={0.7}
        depthWrite={false}
        color="#dfe9ff"
      />
    </points>
  );
}
