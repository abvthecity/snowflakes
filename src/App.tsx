import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Environment, Lightformer, OrbitControls } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { CutMask } from "./cuts";
import { CuttingBoard, NO_PATH, type CutPath } from "./CuttingBoard";
import { FOLD_METHODS, TRIM_CUT, TRIM_LINE, foldMethod, type FoldMethod } from "./folds";
import { outline } from "./penPath";
import { Paper } from "./Paper";
import { Snowfall } from "./Snowfall";
import { Stroke } from "./Stroke";
import { webgpu } from "./gpu";
import { randomCuts } from "./randomCuts";
import { PAPER_COLOURS, paperColour } from "./paperColours";

type Stage = "flat" | "folding" | "trimming" | "cutting" | "unfolding" | "open" | "still";

// The URL can set the scene up directly, for screenshots and for sharing:
//   ?demo=<seed>   cut a sample pattern (the seed picks which) and unfold it
//   &fold=<0–4>    hold the paper at that point of folding instead
//   ?method=<id>   fold it this way (see FOLD_METHODS): diagonal or half
const PARAMS = new URLSearchParams(location.search);
const START_METHOD = foldMethod(PARAMS.get("method"));
const DEMO = PARAMS.get("demo");
//   &lite          skip shadows and antialiasing (software renderers, slow GPUs)
const LITE = PARAMS.has("lite");
//   &paper=<id>    start on that colour of paper (see paperColours.ts)
const START_COLOUR = paperColour(PARAMS.get("paper"));
const STILL_FOLD = PARAMS.has("fold") ? Math.min(4, Math.max(0, Number(PARAMS.get("fold")))) : null;

/** Seconds per fold. */
const FOLD_TIME = 0.9;

/** Where the folded wedge sits, and a camera that frames it head-on for cutting. */
const WEDGE_CENTRE = new THREE.Vector3(0, 0.68, 0);
/**
 * Each view is a camera position and target, plus how far the content reaches
 * across (`fit[0]`) and up (`fit[1]`) from the target, so a narrow phone
 * screen can back the camera off until it all fits.
 */
interface View {
  position: THREE.Vector3;
  target: THREE.Vector3;
  fit: readonly [number, number];
}
const VIEWS: Record<"flat" | "folded" | "halved" | "cutting" | "open", View> = {
  flat: { position: new THREE.Vector3(0, -1.6, 3.6), target: new THREE.Vector3(0, 0, 0), fit: [1.35, 1.2] },
  folded: { position: new THREE.Vector3(0, -0.5, 3.1), target: new THREE.Vector3(0, 0.35, 0), fit: [1.1, 0.85] },
  // Folded in half first, the paper sits above its folded edge and reaches higher.
  halved: { position: new THREE.Vector3(0, -0.2, 3.1), target: new THREE.Vector3(0, 0.62, 0), fit: [1.1, 0.85] },
  cutting: { position: new THREE.Vector3(0, 0.68, 2.25), target: WEDGE_CENTRE, fit: [0.45, 0.78] },
  open: { position: new THREE.Vector3(0.4, -0.6, 3.4), target: new THREE.Vector3(0, 0, 0), fit: [1.1, 1.1] },
};

/** Half the camera's vertical field of view, in radians. */
const HALF_FOV = (40 / 2) * (Math.PI / 180);

function viewFor(stage: Stage, folds: number, method: FoldMethod) {
  const folded = method.foldedView === "halved" ? VIEWS.halved : VIEWS.folded;
  if (stage === "still") return STILL_FOLD! >= 3.5 ? VIEWS.cutting : STILL_FOLD! >= 1 ? folded : VIEWS.open;
  if (stage === "cutting" || stage === "trimming") return VIEWS.cutting;
  if (stage === "open" || stage === "unfolding") return VIEWS.open;
  // While folding, frame the paper as it shrinks: whole sheet, half, wedge.
  if (folds >= method.narrowAt) return VIEWS.cutting;
  if (folds >= 1) return folded;
  return VIEWS.flat;
}

/** Eases the camera to each stage's view; hands control back to the user once it arrives. */
function CameraRig({
  stage,
  folds,
  method,
  controls,
  panel,
}: {
  stage: Stage;
  folds: number;
  method: FoldMethod;
  controls: React.RefObject<OrbitControlsImpl | null>;
  panel: React.RefObject<HTMLDivElement | null>;
}) {
  const { camera, size } = useThree();
  const moving = useRef(true);
  const inset = useRef(0);
  const goal = useMemo(() => new THREE.Vector3(), []);
  const offset = useMemo(() => new THREE.Vector3(), []);
  useEffect(() => {
    moving.current = true;
  }, [stage, folds, size.width, size.height]);

  useFrame((_, dt) => {
    const c = controls.current;
    const cam = camera as THREE.PerspectiveCamera;

    // On a phone the panel spans the bottom of the screen: aim the view at
    // the space above it, by shifting the frustum up by half its height.
    const rect = panel.current?.getBoundingClientRect();
    const covered = rect && rect.width > size.width * 0.8 ? size.height - rect.top + 8 : 0;
    if (covered !== inset.current) {
      inset.current = covered;
      if (covered) cam.setViewOffset(size.width, size.height, 0, covered / 2, size.width, size.height);
      else cam.clearViewOffset();
      moving.current = true;
    }

    if (!moving.current || !c) return;
    const view = viewFor(stage, folds, method);
    // Back off until the content fits across a narrow screen and above the panel.
    const across = view.fit[0] / (Math.tan(HALF_FOV) * cam.aspect);
    const up = view.fit[1] / (Math.tan(HALF_FOV) * Math.max(0.3, 1 - covered / size.height));
    offset.copy(view.position).sub(view.target);
    offset.setLength(Math.max(offset.length(), across, up));
    goal.copy(view.target).add(offset);

    const k = stage === "still" ? 1 : 1 - Math.exp(-dt * 3);
    camera.position.lerp(goal, k);
    c.target.lerp(view.target, k);
    c.update();
    if (camera.position.distanceTo(goal) < 0.002) moving.current = false;
  });
  return null;
}

/** Drives the fold amount toward its target (0 flat, 4 fully folded) and reports when it arrives. */
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

/** The dashed line across the top of the folded paper, where the trim goes. */
function TrimGuide() {
  const [p, q] = TRIM_LINE;
  const d = [q[0] - p[0], q[1] - p[1]];
  const ends = [-0.12, 1.12].map((t) => [p[0] + d[0] * t, p[1] + d[1] * t, 0.07] as [number, number, number]);
  return <Stroke points={ends} color="#e2483d" lineWidth={2.5} dashed dashSize={0.025} gapSize={0.015} />;
}

/**
 * Marks the page ready (`<html data-ready>`) once every material in the scene
 * has compiled and a frame has drawn with them, so screenshots can wait for
 * it, and notes which renderer drew it (`data-renderer`).
 */
function Ready() {
  const { gl, scene, camera } = useThree();
  useEffect(() => {
    let live = true;
    gl.compileAsync(scene, camera).then(() =>
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (!live) return;
          document.documentElement.dataset.renderer = webgpu() ? "webgpu" : "webgl";
          document.documentElement.dataset.ready = "true";
        }),
      ),
    );
    return () => {
      live = false;
    };
  }, [gl, scene, camera]);
  return null;
}

/**
 * A gentle sway once the snowflake is open, as if it hung on a thread. It
 * settles while `held`, so a drag's turn never adds to it.
 */
function Sway({ active, held, children }: { active: boolean; held: React.RefObject<boolean>; children: React.ReactNode }) {
  const group = useRef<THREE.Group>(null);
  const t = useRef(0);
  useFrame((_, dt) => {
    const g = group.current;
    if (!g) return;
    t.current += dt;
    const amount = active && !held.current ? 1 : 0;
    const k = 1 - Math.exp(-dt * 2);
    g.rotation.y = THREE.MathUtils.lerp(g.rotation.y, amount * Math.sin(t.current * 0.6) * 0.45, k);
    g.rotation.x = THREE.MathUtils.lerp(g.rotation.x, amount * Math.sin(t.current * 0.43) * 0.12, k);
  });
  return <group ref={group}>{children}</group>;
}

/**
 * The furthest a drag can turn the paper, in radians, in any direction. The
 * paper is thin enough to vanish edge-on, and the resting views already tilt
 * it up to about 25°, so this keeps it well short of 90° from the camera.
 */
const MAX_TURN = 0.6;
/** Radians of turn per screen height dragged, before the resistance sets in. */
const TURN_GAIN = 2.4;

/**
 * Drag to turn the paper, on a rubber band: the further it turns the harder
 * it pulls, never past `MAX_TURN`, and letting go eases it back to face the
 * camera, the one view where a paper snowflake reads. It turns about the
 * camera's own axes and the point the camera looks at.
 */
function DragTurn({
  enabled,
  controls,
  held,
  children,
}: {
  enabled: boolean;
  controls: React.RefObject<OrbitControlsImpl | null>;
  held: React.RefObject<boolean>;
  children: React.ReactNode;
}) {
  const { gl, camera, size } = useThree();
  const group = useRef<THREE.Group>(null);
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  const pull = useRef(new THREE.Vector2());
  const turn = useRef(new THREE.Vector2());
  const pointers = useRef(new Set<number>());
  const tmp = useMemo(
    () => ({ yaw: new THREE.Quaternion(), pitch: new THREE.Quaternion(), axis: new THREE.Vector3(), pivot: new THREE.Vector3() }),
    [],
  );

  useEffect(() => {
    const el = gl.domElement;
    const release = () => {
      drag.current = null;
      pull.current.set(0, 0);
    };
    const down = (e: PointerEvent) => {
      pointers.current.add(e.pointerId);
      // A second finger means a pinch to zoom: let go of the turn.
      if (pointers.current.size > 1) return release();
      if (enabled) drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
    };
    const move = (e: PointerEvent) => {
      const d = drag.current;
      if (!d || d.id !== e.pointerId) return;
      const scale = TURN_GAIN / size.height;
      pull.current.set((e.clientX - d.x) * scale, (e.clientY - d.y) * scale);
    };
    const up = (e: PointerEvent) => {
      pointers.current.delete(e.pointerId);
      if (drag.current?.id === e.pointerId) release();
    };
    el.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      el.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [gl, size.height, enabled]);

  useEffect(() => {
    if (!enabled) {
      drag.current = null;
      pull.current.set(0, 0);
    }
  }, [enabled]);

  useFrame((_, dt) => {
    const g = group.current;
    if (!g) return;
    // Resistance: the turn follows the drag at first, then tapers off toward MAX_TURN.
    // Capped on the drag's length, not per axis, so a diagonal can't add up past the limit.
    const reach = pull.current.length();
    const band = reach > 1e-6 ? (MAX_TURN * Math.tanh(reach / MAX_TURN)) / reach : 1;
    const goalX = pull.current.x * band;
    const goalY = pull.current.y * band;
    // Snappy while held, a gentle glide home once let go.
    held.current = drag.current !== null;
    const k = 1 - Math.exp(-dt * (drag.current ? 18 : 4));
    turn.current.x += (goalX - turn.current.x) * k;
    turn.current.y += (goalY - turn.current.y) * k;
    if (!drag.current && turn.current.lengthSq() < 1e-8) turn.current.set(0, 0);

    tmp.yaw.setFromAxisAngle(tmp.axis.set(0, 1, 0).applyQuaternion(camera.quaternion), turn.current.x);
    tmp.pitch.setFromAxisAngle(tmp.axis.set(1, 0, 0).applyQuaternion(camera.quaternion), turn.current.y);
    g.quaternion.multiplyQuaternions(tmp.yaw, tmp.pitch);
    // Turn about the point the camera looks at, not the world origin.
    const target = controls.current?.target;
    if (target) tmp.pivot.copy(target);
    else tmp.pivot.set(0, 0, 0);
    g.position.copy(tmp.pivot).sub(tmp.axis.copy(tmp.pivot).applyQuaternion(g.quaternion));
  });

  return <group ref={group}>{children}</group>;
}

/** Four folds, then the trim, the cuts, and unfolding. */
const STEP_COUNT = 4 + 3;

/** What the scissors do next, by where the shape is at. */
const CUT_HINTS = {
  start:
    "Tap corner after corner for straight cuts, or drag to draw. Close the shape on its first point to cut through all twelve layers.",
  open: "Keep tapping or drawing; the faded part is what falls away. Tap the first point (or press Cut) to cut, or tap a point to round it.",
  closed: "Drag a point or its blue handles to reshape the cut, tap a point to round or sharpen it, or start the next cut anywhere.",
};

const COPY: Record<Exclude<Stage, "flat">, { title: string; body: string }> = {
  folding: { title: "Folding…", body: "" },
  trimming: {
    title: "Trim the top",
    body: "Slice straight across the top of the folded paper, along the dashed line. That is what opens into a hexagon instead of a square.",
  },
  cutting: { title: "Cut", body: "" },
  unfolding: { title: "Unfolding…", body: "" },
  still: { title: "Paper snowflake", body: "" },
  open: { title: "Your snowflake", body: "Drag to turn it. Fold it back up to keep cutting." },
};

export function App() {
  const mask = useMemo(() => new CutMask(), []);
  const [stage, setStage] = useState<Stage>("flat");
  const [cuts, setCuts] = useState(0);
  /** How many folds the paper is heading for, 0 to 4. */
  const [folds, setFolds] = useState(0);
  const [method, setMethod] = useState<FoldMethod>(START_METHOD);
  const [path, setPath] = useState<CutPath>(NO_PATH);
  const [colour, setColour] = useState(START_COLOUR);
  const fold = useRef(0);
  const controls = useRef<OrbitControlsImpl>(null);
  const panel = useRef<HTMLDivElement>(null);
  const held = useRef(false);

  const foldTarget =
    stage === "folding" || stage === "trimming" || stage === "cutting" ? folds : stage === "unfolding" ? 0 : fold.current;

  mask.setMethod(method);

  useEffect(() => {
    if (DEMO !== null && mask.count === 0) {
      mask.trim(TRIM_CUT);
      for (const c of randomCuts(Number(DEMO) || 3)) mask.cut(c);
      setCuts(mask.count);
    }
    if (STILL_FOLD !== null) {
      fold.current = STILL_FOLD;
      setStage("still");
    } else if (DEMO !== null) {
      fold.current = 4;
      setFolds(4);
      setStage("unfolding");
    }
  }, [mask]);

  const onArrive = () => {
    setStage((s) => {
      if (s === "unfolding") return "open";
      if (s !== "folding") return s;
      if (folds < method.steps.length) return "flat";
      return mask.isTrimmed ? "cutting" : "trimming";
    });
  };

  const copy = stage === "flat" ? method.steps[folds] : COPY[stage];
  // The way to fold can change until the first fold is made.
  const choosing = stage === "flat" && folds === 0;
  const step =
    stage === "flat"
      ? folds + 1
      : stage === "trimming"
        ? 5
        : stage === "cutting"
          ? 6
          : stage === "open" || stage === "unfolding"
            ? 7
            : null;
  const busy = stage === "folding" || stage === "unfolding";
  /** A shape is being drawn and has not been cut yet. */
  const open = !path.closed && path.anchors.length > 0;

  return (
    <div className="app">
      <Canvas
        shadows={!LITE}
        dpr={LITE ? 1 : [1, 2]}
        gl={(defaults) => {
          const kit = webgpu();
          // Fiber awaits a renderer that needs async setup, though its types don't say so.
          if (kit) return kit.createRenderer(defaults.canvas as HTMLCanvasElement, !LITE) as unknown as THREE.WebGLRenderer;
          return new THREE.WebGLRenderer({ ...defaults, antialias: !LITE, preserveDrawingBuffer: true });
        }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.NeutralToneMapping;
          gl.toneMappingExposure = 1.05;
        }}
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

        <DragTurn enabled={stage === "flat" || stage === "open" || stage === "still"} controls={controls} held={held}>
          <Sway active={stage === "open"} held={held}>
            <Paper
              method={method}
              fold={fold}
              mask={mask.texture}
              creased={stage !== "flat" && !(stage === "still" && cuts === 0)}
              colour={colour.hex}
            />
          </Sway>
        </DragTurn>
        {stage === "trimming" && <TrimGuide />}
        {stage === "cutting" && (
          <CuttingBoard
            path={path}
            setPath={setPath}
            mask={mask}
            onClose={(anchors) => {
              mask.cut(outline(anchors, true));
              setCuts(mask.count);
              setPath({ anchors, closed: true });
            }}
            onLift={() => {
              mask.undo();
              setCuts(mask.count);
            }}
          />
        )}
        <Snowfall />
        <Ready />

        <FoldDriver fold={fold} target={foldTarget} onArrive={onArrive} />
        <CameraRig stage={stage} folds={folds} method={method} controls={controls} panel={panel} />
        <OrbitControls
          ref={controls}
          enabled={stage === "flat" || stage === "open" || stage === "still"}
          enablePan={false}
          enableRotate={false}
          minDistance={1.4}
          maxDistance={7}
        />
      </Canvas>

      <div className="panel" ref={panel}>
        {step && (
          <div className="step">
            Step {step} of {STEP_COUNT}
          </div>
        )}
        <h1>{copy.title}</h1>
        {copy.body && <p>{copy.body}</p>}
        {choosing && (
          <div className="segmented" role="radiogroup" aria-label="Way to fold">
            {FOLD_METHODS.map((m) => (
              <button
                key={m.id}
                role="radio"
                aria-checked={method === m}
                className={method === m ? "on" : undefined}
                onClick={() => setMethod(m)}
              >
                {m.label}
              </button>
            ))}
          </div>
        )}
        {choosing && (
          <div className="papers">
            <span className="papers-label">Paper</span>
            <div className="swatches" role="radiogroup" aria-label="Paper colour">
              {PAPER_COLOURS.map((c) => (
                <button
                  key={c.id}
                  role="radio"
                  aria-checked={colour.id === c.id}
                  aria-label={c.name}
                  title={c.name}
                  className={colour.id === c.id ? "swatch on" : "swatch"}
                  style={{ "--swatch": c.hex } as React.CSSProperties}
                  onClick={() => setColour(c)}
                />
              ))}
            </div>
            <span className="papers-name">{colour.name}</span>
          </div>
        )}
        {stage === "cutting" && (
          <p>{CUT_HINTS[path.closed ? "closed" : path.anchors.length ? "open" : "start"]}</p>
        )}
        <div className="actions">
          {stage === "flat" && (
            <button
              onClick={() => {
                setFolds(folds + 1);
                setStage("folding");
              }}
            >
              Fold
            </button>
          )}
          {stage === "trimming" && (
            <button
              onClick={() => {
                mask.trim(TRIM_CUT);
                setStage("cutting");
              }}
            >
              Trim
            </button>
          )}
          {stage === "cutting" && open && (
            <>
              <button
                disabled={path.anchors.length < 3}
                onClick={() => {
                  mask.cut(outline(path.anchors, true));
                  setCuts(mask.count);
                  setPath({ anchors: path.anchors, closed: true });
                }}
              >
                Cut
              </button>
              <button className="quiet" onClick={() => setPath(NO_PATH)}>
                Cancel
              </button>
            </>
          )}
          {stage === "cutting" && !open && (
            <>
              <button
                disabled={cuts === 0}
                onClick={() => {
                  setPath(NO_PATH);
                  setStage("unfolding");
                }}
              >
                Unfold
              </button>
              <button
                className="quiet"
                onClick={() => {
                  setPath(NO_PATH);
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
                  setPath(NO_PATH);
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
              <button
                onClick={() => {
                  setFolds(method.steps.length);
                  setStage("folding");
                }}
              >
                Fold back up
              </button>
              <button
                className="quiet"
                onClick={() => {
                  mask.clear();
                  setCuts(0);
                  fold.current = 0;
                  setFolds(0);
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
