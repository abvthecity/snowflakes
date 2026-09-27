import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Environment, Lightformer, Line, OrbitControls } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { CutMask } from "./cuts";
import type { Vec2 } from "./folds";
import { Paper } from "./Paper";
import { Snowfall } from "./Snowfall";
import { randomCuts } from "./randomCuts";

type Stage = "flat" | "folding" | "cutting" | "unfolding" | "open" | "still";

// The URL can set the scene up directly, for screenshots and for sharing:
//   ?demo=<seed>   cut a sample pattern (the seed picks which) and unfold it
//   &fold=<0–4>    hold the paper at that point of folding instead
const PARAMS = new URLSearchParams(location.search);
const DEMO = PARAMS.get("demo");
//   &lite          skip shadows and antialiasing (software renderers, slow GPUs)
const LITE = PARAMS.has("lite");
const STILL_FOLD = PARAMS.has("fold") ? Math.min(4, Math.max(0, Number(PARAMS.get("fold")))) : null;

/** Seconds per fold. */
const FOLD_TIME = 0.9;

/** Where the folded wedge sits, and a camera that frames it head-on for cutting. */
const WEDGE_CENTRE = new THREE.Vector3(-0.14, 0.7, 0);
const VIEWS = {
  flat: { position: new THREE.Vector3(0, -1.6, 3.6), target: new THREE.Vector3(0, 0, 0) },
  cutting: { position: new THREE.Vector3(-0.14, 0.7, 1.95), target: WEDGE_CENTRE },
  open: { position: new THREE.Vector3(0.4, -0.6, 3.4), target: new THREE.Vector3(0, 0, 0) },
};

function viewFor(stage: Stage) {
  if (stage === "still") return STILL_FOLD! >= 3.5 ? VIEWS.cutting : VIEWS.open;
  if (stage === "cutting" || stage === "folding") return VIEWS.cutting;
  if (stage === "open" || stage === "unfolding") return VIEWS.open;
  return VIEWS.flat;
}

/** Eases the camera to each stage's view; hands control back to the user once it arrives. */
function CameraRig({ stage, controls }: { stage: Stage; controls: React.RefObject<OrbitControlsImpl | null> }) {
  const { camera } = useThree();
  const moving = useRef(true);
  useEffect(() => {
    moving.current = true;
  }, [stage]);
  useFrame((_, dt) => {
    const c = controls.current;
    if (!moving.current || !c) return;
    const view = viewFor(stage);
    const k = stage === "still" ? 1 : 1 - Math.exp(-dt * 3);
    camera.position.lerp(view.position, k);
    c.target.lerp(view.target, k);
    c.update();
    if (camera.position.distanceTo(view.position) < 0.002) moving.current = false;
  });
  return null;
}

/** Drives the fold amount toward 4 (folded) or 0 (open) and reports when it arrives. */
function FoldDriver({ fold, target, onArrive }: { fold: React.RefObject<number>; target: number; onArrive: () => void }) {
  const arrived = useRef(true);
  useEffect(() => {
    arrived.current = fold.current === target;
  }, [target, fold]);
  useFrame((_, dt) => {
    const step = Math.min(dt, 0.25) / FOLD_TIME;
    const f = fold.current;
    if (f === target) {
      if (!arrived.current) {
        arrived.current = true;
        onArrive();
      }
      return;
    }
    fold.current = f < target ? Math.min(target, f + step) : Math.max(target, f - step);
  });
  return null;
}

/** An invisible sheet over the folded paper that turns pointer strokes into cuts. */
function CuttingBoard({ onCut }: { onCut: (outline: Vec2[]) => void }) {
  const [stroke, setStroke] = useState<Vec2[]>([]);
  const drawing = useRef(false);

  const add = (e: ThreeEvent<PointerEvent>) => {
    const p: Vec2 = [e.point.x, e.point.y];
    setStroke((s) => {
      const last = s[s.length - 1];
      if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < 0.006) return s;
      return [...s, p];
    });
  };

  const finish = () => {
    if (!drawing.current) return;
    drawing.current = false;
    setStroke((s) => {
      if (s.length > 2) onCut(s);
      return [];
    });
  };

  return (
    <>
      <mesh
        position={[0, 0.6, 0.08]}
        onPointerDown={(e) => {
          e.stopPropagation();
          (e.target as Element).setPointerCapture?.(e.pointerId);
          drawing.current = true;
          setStroke([]);
          add(e);
        }}
        onPointerMove={(e) => drawing.current && add(e)}
        onPointerUp={finish}
        onPointerLeave={finish}
      >
        <planeGeometry args={[6, 6]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {stroke.length > 1 && (
        <Line
          points={[...stroke, stroke[0]].map(([x, y]) => [x, y, 0.09] as [number, number, number])}
          color="#e2483d"
          lineWidth={2.5}
          dashed
          dashSize={0.02}
          gapSize={0.012}
        />
      )}
    </>
  );
}

/** A gentle sway once the snowflake is open, as if it hung on a thread. */
function Sway({ active, children }: { active: boolean; children: React.ReactNode }) {
  const group = useRef<THREE.Group>(null);
  const t = useRef(0);
  useFrame((_, dt) => {
    const g = group.current;
    if (!g) return;
    t.current += dt;
    const amount = active ? 1 : 0;
    const k = 1 - Math.exp(-dt * 2);
    g.rotation.y = THREE.MathUtils.lerp(g.rotation.y, amount * Math.sin(t.current * 0.6) * 0.45, k);
    g.rotation.x = THREE.MathUtils.lerp(g.rotation.x, amount * Math.sin(t.current * 0.43) * 0.12, k);
  });
  return <group ref={group}>{children}</group>;
}

const COPY: Record<Stage, { title: string; body: string }> = {
  flat: { title: "A square of paper", body: "Fold it diagonally, then in half three more times." },
  folding: { title: "Folding…", body: "Four folds, sixteen layers." },
  cutting: {
    title: "Cut",
    body: "Draw a closed shape across the folded paper. Wherever it overlaps the paper, the scissors cut through all sixteen layers.",
  },
  unfolding: { title: "Unfolding…", body: "" },
  still: { title: "Paper snowflake", body: "" },
  open: { title: "Your snowflake", body: "Drag to turn it. Fold it back up to keep cutting." },
};

export function App() {
  const mask = useMemo(() => new CutMask(), []);
  const [stage, setStage] = useState<Stage>("flat");
  const [cuts, setCuts] = useState(0);
  const fold = useRef(0);
  const controls = useRef<OrbitControlsImpl>(null);

  const foldTarget = stage === "folding" || stage === "cutting" ? 4 : stage === "unfolding" ? 0 : fold.current;

  useEffect(() => {
    if (DEMO !== null && mask.count === 0) {
      for (const c of randomCuts(Number(DEMO) || 3)) mask.cut(c);
      setCuts(mask.count);
    }
    if (STILL_FOLD !== null) {
      fold.current = STILL_FOLD;
      setStage("still");
    } else if (DEMO !== null) {
      fold.current = 4;
      setStage("unfolding");
    }
  }, [mask]);

  const onArrive = () => {
    setStage((s) => (s === "folding" ? "cutting" : s === "unfolding" ? "open" : s));
  };

  const copy = COPY[stage];
  const busy = stage === "folding" || stage === "unfolding";

  return (
    <div className="app">
      <Canvas
        shadows={!LITE}
        dpr={LITE ? 1 : [1, 2]}
        gl={{ antialias: !LITE, preserveDrawingBuffer: true, toneMapping: THREE.NeutralToneMapping, toneMappingExposure: 1.05 }}
        camera={{ position: VIEWS.flat.position.toArray(), fov: 40, near: 0.05, far: 50 }}
      >
        <Environment resolution={256}>
          <Lightformer form="rect" intensity={2.2} color="#dbe8ff" position={[0, 3, 4]} scale={[6, 3, 1]} />
          <Lightformer form="rect" intensity={1.2} color="#ffe6c7" position={[-4, 1, 1]} rotation-y={Math.PI / 2} scale={[4, 4, 1]} />
          <Lightformer form="ring" intensity={3} color="#ffffff" position={[3, 2, 3]} scale={1.5} />
        </Environment>
        <ambientLight intensity={0.1} />
        <directionalLight
          position={[2.2, 2.6, 3.2]}
          intensity={2.6}
          color="#fff6ea"
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-bias={-0.0004}
        />
        {/* Behind the paper: what shines through it. */}
        <directionalLight position={[-1, 1.5, -3]} intensity={1.4} color="#ffd7a1" />

        <Sway active={stage === "open"}>
          <Paper fold={fold} mask={mask.texture} creased={stage !== "flat" && !(stage === "still" && cuts === 0)} />
        </Sway>
        {stage === "cutting" && (
          <CuttingBoard
            onCut={(outline) => {
              mask.cut(outline);
              setCuts(mask.count);
            }}
          />
        )}
        <Snowfall />

        <FoldDriver fold={fold} target={foldTarget} onArrive={onArrive} />
        <CameraRig stage={stage} controls={controls} />
        <OrbitControls
          ref={controls}
          enabled={stage === "flat" || stage === "open" || stage === "still"}
          enablePan={false}
          minDistance={1.4}
          maxDistance={7}
        />
      </Canvas>

      <div className="panel">
        <h1>{copy.title}</h1>
        {copy.body && <p>{copy.body}</p>}
        <div className="actions">
          {stage === "flat" && <button onClick={() => setStage("folding")}>Fold</button>}
          {stage === "cutting" && (
            <>
              <button disabled={cuts === 0} onClick={() => setStage("unfolding")}>
                Unfold
              </button>
              <button
                className="quiet"
                onClick={() => {
                  for (const c of randomCuts(3)) mask.cut(c);
                  setCuts(mask.count);
                }}
              >
                Surprise me
              </button>
              <button
                className="quiet"
                disabled={cuts === 0}
                onClick={() => {
                  mask.undo();
                  setCuts(mask.count);
                }}
              >
                Undo
              </button>
            </>
          )}
          {stage === "open" && (
            <>
              <button onClick={() => setStage("folding")}>Fold back up</button>
              <button
                className="quiet"
                onClick={() => {
                  mask.clear();
                  setCuts(0);
                  fold.current = 0;
                  setStage("flat");
                }}
              >
                New paper
              </button>
            </>
          )}
          {busy && <span className="hint">…</span>}
        </div>
      </div>
    </div>
  );
}
