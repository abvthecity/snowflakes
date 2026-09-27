import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Environment, Lightformer, OrbitControls } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { CutMask } from "./cuts";
import { CuttingBoard, type CutTool } from "./CuttingBoard";
import { TRIM_CUT, TRIM_LINE } from "./folds";
import { type Anchor } from "./penPath";
import type { Vec2 } from "./folds";
import { Paper } from "./Paper";
import { Snowfall } from "./Snowfall";
import { Stroke } from "./Stroke";
import { webgpu } from "./gpu";
import { randomCuts } from "./randomCuts";
import { Recorder, cutShape, drawTime, finalPaper, outlineCut, penCut, type CutKind, type Recording, type TimelineEvent } from "./timeline";
import { loadSnowflake, saveSnowflake, shareUrl } from "./api";

type Stage = "flat" | "folding" | "trimming" | "cutting" | "unfolding" | "open" | "still";

// The URL can set the scene up directly, for screenshots and for sharing:
//   ?demo=<seed>   cut a sample pattern (the seed picks which) and unfold it
//   &fold=<0–4>    hold the paper at that point of folding instead
const PARAMS = new URLSearchParams(location.search);
const DEMO = PARAMS.get("demo");
//   &lite          skip shadows and antialiasing (software renderers, slow GPUs)
const LITE = PARAMS.has("lite");
const STILL_FOLD = PARAMS.has("fold") ? Math.min(4, Math.max(0, Number(PARAMS.get("fold")))) : null;
//   ?s=<id>        open a saved snowflake, which can replay how it was cut
const SHARED = PARAMS.get("s");

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
const VIEWS: Record<"flat" | "folded" | "cutting" | "open", View> = {
  flat: { position: new THREE.Vector3(0, -1.6, 3.6), target: new THREE.Vector3(0, 0, 0), fit: [1.35, 1.2] },
  folded: { position: new THREE.Vector3(0, -0.5, 3.1), target: new THREE.Vector3(0, 0.35, 0), fit: [1.1, 0.85] },
  cutting: { position: new THREE.Vector3(0, 0.68, 2.25), target: WEDGE_CENTRE, fit: [0.45, 0.78] },
  open: { position: new THREE.Vector3(0.4, -0.6, 3.4), target: new THREE.Vector3(0, 0, 0), fit: [1.1, 1.1] },
};

/** Half the camera's vertical field of view, in radians. */
const HALF_FOV = (40 / 2) * (Math.PI / 180);

function viewFor(stage: Stage, folds: number) {
  if (stage === "still") return STILL_FOLD! >= 3.5 ? VIEWS.cutting : VIEWS.open;
  if (stage === "cutting" || stage === "trimming") return VIEWS.cutting;
  if (stage === "open" || stage === "unfolding") return VIEWS.open;
  // While folding, frame the paper as it shrinks: whole sheet, triangle, wedge.
  if (folds >= 3) return VIEWS.cutting;
  if (folds >= 1) return VIEWS.folded;
  return VIEWS.flat;
}

/** Eases the camera to each stage's view; hands control back to the user once it arrives. */
function CameraRig({
  stage,
  folds,
  controls,
  panel,
}: {
  stage: Stage;
  folds: number;
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
    const view = viewFor(stage, folds);
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
function FoldDriver({
  fold,
  target,
  speed,
  onArrive,
}: {
  fold: React.RefObject<number>;
  target: number;
  /** Folds this many times faster (skipping through a replay). */
  speed: React.RefObject<number>;
  onArrive: () => void;
}) {
  const arrived = useRef(true);
  useEffect(() => {
    arrived.current = fold.current === target;
  }, [target, fold]);
  useFrame((_, dt) => {
    const step = (Math.min(dt, 0.25) / FOLD_TIME) * speed.current;
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

/** The four folds, one step each, in the order of the paper guide. */
const FOLD_STEPS = [
  {
    title: "Fold corner to corner",
    body: "Start with a square of paper. Bring the bottom right corner up to the top left one, making a triangle.",
  },
  { title: "Fold in half", body: "Fold the triangle in half, bringing its two sharp corners together." },
  { title: "Fold one side across", body: "From the point at the bottom, fold the left side over by a third." },
  {
    title: "Fold the other side across",
    body: "Fold the right side over on top, so the paper makes a narrow cone twelve layers thick.",
  },
];

const STEP_COUNT = FOLD_STEPS.length + 3;

const TOOLS: { id: CutTool; label: string; hint: string }[] = [
  { id: "freehand", label: "Freehand", hint: "Draw a loop across the folded paper with a finger or the mouse. Letting go cuts it out of all twelve layers." },
  { id: "straight", label: "Straight", hint: "Tap or click corner after corner, then the first corner again (or press Cut) to cut along straight lines." },
  { id: "curve", label: "Curve", hint: "Tap for a sharp corner, or press and drag to pull a smooth curve. Tap the first point again (or press Cut) to cut." },
];

const COPY: Record<Stage, { title: string; body: string }> = {
  flat: FOLD_STEPS[0],
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

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
const nextFrame = () => new Promise((done) => requestAnimationFrame(done));

type SaveState = { state: "idle" } | { state: "saving" } | { state: "saved"; id: string; copied?: boolean } | { state: "error"; message: string };

export function App() {
  const mask = useMemo(() => new CutMask(), []);
  const recorder = useMemo(() => new Recorder(), []);
  const [stage, setStage] = useState<Stage>("flat");
  const [cuts, setCuts] = useState(0);
  /** How many folds the paper is heading for, 0 to 4. */
  const [folds, setFolds] = useState(0);
  const [tool, setTool] = useState<CutTool>("freehand");
  const [anchors, setAnchors] = useState<Anchor[]>([]);
  const [save, setSave] = useState<SaveState>({ state: "idle" });
  /** Opening a saved snowflake from the link: loading, or why it failed. */
  const [opening, setOpening] = useState<"loading" | "missing" | null>(SHARED ? "loading" : null);
  /** Whether the paper on screen is someone's saved snowflake, untouched since it opened. */
  const [shared, setShared] = useState(false);
  const [replaying, setReplaying] = useState(false);
  /** The cut being drawn in a replay. */
  const [ghost, setGhost] = useState<Vec2[]>([]);
  const fold = useRef(0);
  const foldSpeed = useRef(1);
  /** Set to skip the rest of a replay; each step then happens at once. */
  const skip = useRef(false);
  /** Resolved when the paper arrives at its fold target, for replays to wait on. */
  const arrivals = useRef<(() => void)[]>([]);
  const controls = useRef<OrbitControlsImpl>(null);
  const panel = useRef<HTMLDivElement>(null);

  const foldTarget =
    stage === "folding" || stage === "trimming" || stage === "cutting" ? folds : stage === "unfolding" ? 0 : fold.current;

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

  // Open a saved snowflake: lay its cuts on the paper and unfold it.
  useEffect(() => {
    if (!SHARED) return;
    let live = true;
    loadSnowflake(SHARED).then((recording) => {
      if (!live) return;
      if (!recording) {
        setOpening("missing");
        return;
      }
      const paper = finalPaper(recording.events);
      mask.clear();
      if (paper.trimmed) mask.trim(TRIM_CUT);
      for (const c of paper.cuts) mask.cut(c);
      setCuts(mask.count);
      recorder.resume(recording);
      setSave({ state: "saved", id: SHARED });
      setShared(true);
      setOpening(null);
      fold.current = 4;
      setFolds(4);
      setStage("unfolding");
    });
    return () => {
      live = false;
    };
  }, [mask, recorder]);

  const onArrive = () => {
    setStage((s) => {
      if (s === "unfolding") return "open";
      if (s !== "folding") return s;
      if (folds < FOLD_STEPS.length) return "flat";
      return mask.isTrimmed ? "cutting" : "trimming";
    });
    for (const done of arrivals.current.splice(0)) done();
  };

  // Everything that changes the paper, shared by the buttons and replays.
  const act = {
    fold() {
      setFolds((f) => f + 1);
      setStage("folding");
    },
    trim() {
      mask.trim(TRIM_CUT);
      setStage("cutting");
    },
    cut(tool: CutKind, pts: number[]) {
      mask.cut(cutShape({ t: 0, k: "cut", tool, pts }).points);
      setCuts(mask.count);
    },
    undo() {
      mask.undo();
      setCuts(mask.count);
    },
    unfold() {
      setStage("unfolding");
    },
    refold() {
      setFolds(FOLD_STEPS.length);
      setStage("folding");
    },
  };

  /** Do it, and add it to the recording. The paper has changed, so any saved link no longer matches. */
  const record = (e: Parameters<Recorder["add"]>[0]) => {
    recorder.add(e);
    if (e.k === "cut") act.cut(e.tool, e.pts);
    else act[e.k]();
    if (save.state !== "idle") setSave({ state: "idle" });
    if (shared) setShared(false);
    if (SHARED) history.replaceState(null, "", location.pathname);
  };

  const newPaper = () => {
    mask.clear();
    setCuts(0);
    fold.current = 0;
    setFolds(0);
    setAnchors([]);
    setStage("flat");
  };

  /** Plays the recording back on fresh paper, at the pace it was made (long pauses shortened). */
  const replay = async (recording: Recording) => {
    skip.current = false;
    foldSpeed.current = 1;
    setReplaying(true);
    newPaper();
    const wait = async (ms: number) => {
      if (!skip.current) await sleep(ms);
    };
    const arrive = () => new Promise<void>((done) => arrivals.current.push(done));
    await wait(700);
    let prev = recording.events[0]?.t ?? 0;
    for (const e of recording.events as TimelineEvent[]) {
      await wait(Math.min(1200, Math.max(150, e.t - prev)));
      prev = e.t;
      if (skip.current) foldSpeed.current = 40;
      if (e.k === "cut") {
        // Draw the cut again, sped up if it took a while.
        const total = drawTime(e);
        const scale = Math.max(1, total / 2500);
        const start = performance.now();
        while (!skip.current && total > 0) {
          const ms = (performance.now() - start) * scale;
          if (ms >= total) break;
          setGhost(cutShape(e, ms).points);
          await nextFrame();
        }
        setGhost([]);
        act.cut(e.tool, e.pts);
        if (e.tool !== "surprise") await wait(250);
      } else {
        const moves = e.k === "fold" || e.k === "refold" || e.k === "unfold";
        const arrived = moves ? arrive() : null;
        act[e.k]();
        if (arrived) await arrived;
      }
    }
    foldSpeed.current = 1;
    setReplaying(false);
  };

  const onSave = async () => {
    setSave({ state: "saving" });
    const result = await saveSnowflake(recorder.recording);
    if ("error" in result) {
      setSave({ state: "error", message: result.error });
      return;
    }
    history.replaceState(null, "", shareUrl(result.id));
    setSave({ state: "saved", id: result.id });
  };

  const copyLink = async (id: string) => {
    const url = shareUrl(id);
    try {
      if (navigator.share && matchMedia("(pointer: coarse)").matches) await navigator.share({ title: "Paper snowflake", url });
      else await navigator.clipboard.writeText(url);
      setSave({ state: "saved", id, copied: true });
    } catch {
      // Dismissed the share sheet, or no clipboard: the link is on screen to copy by hand.
    }
  };

  const copy = opening
    ? opening === "loading"
      ? { title: "Opening a snowflake…", body: "" }
      : { title: "Snowflake not found", body: "That link doesn't lead to a saved snowflake. Fold a new one here instead." }
    : replaying
      ? stage === "flat"
        ? { title: "Replaying…", body: FOLD_STEPS[folds]?.body ?? "" }
        : { title: "Replaying…", body: COPY[stage].body }
      : stage === "flat"
        ? FOLD_STEPS[folds]
        : stage === "open" && shared
          ? { title: "A paper snowflake", body: "Someone folded and cut this. Watch how they made it, or fold it back up and keep cutting." }
          : COPY[stage];
  const step =
    opening || replaying
      ? null
      : stage === "flat"
        ? folds + 1
        : stage === "trimming"
          ? 5
          : stage === "cutting"
            ? 6
            : stage === "open" || stage === "unfolding"
              ? 7
              : null;
  const busy = stage === "folding" || stage === "unfolding";
  const canReplay = recorder.events.some((e) => e.k === "cut");

  return (
    <div className="app" data-stage={stage}>
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

        <Sway active={stage === "open"}>
          <Paper fold={fold} mask={mask.texture} creased={stage !== "flat" && !(stage === "still" && cuts === 0)} />
        </Sway>
        {stage === "trimming" && <TrimGuide />}
        {stage === "cutting" && !replaying && (
          <CuttingBoard
            tool={tool}
            anchors={anchors}
            setAnchors={setAnchors}
            onCut={(pts) => record({ k: "cut", tool, pts })}
          />
        )}
        {ghost.length > 1 && (
          <Stroke points={ghost.map(([x, y]) => [x, y, 0.09] as [number, number, number])} color="#e2483d" lineWidth={2.5} />
        )}
        <Snowfall />
        <Ready />

        <FoldDriver fold={fold} target={foldTarget} speed={foldSpeed} onArrive={onArrive} />
        <CameraRig stage={stage} folds={folds} controls={controls} panel={panel} />
        <OrbitControls
          ref={controls}
          enabled={stage === "flat" || stage === "open" || stage === "still"}
          enablePan={false}
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
        {stage === "cutting" && !replaying && (
          <>
            <div className="tools" role="radiogroup" aria-label="Scissors">
              {TOOLS.map((t) => (
                <button
                  key={t.id}
                  role="radio"
                  aria-checked={tool === t.id}
                  className={tool === t.id ? "tool on" : "tool"}
                  onClick={() => {
                    setTool(t.id);
                    setAnchors([]);
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <p>{TOOLS.find((t) => t.id === tool)!.hint}</p>
          </>
        )}
        {stage === "open" && !replaying && save.state === "saved" && (
          <div className="share">
            <input readOnly value={shareUrl(save.id)} aria-label="Link to this snowflake" onFocus={(e) => e.target.select()} />
          </div>
        )}
        {stage === "open" && !replaying && save.state === "error" && <p className="error">Couldn't save: {save.message}</p>}
        <div className="actions">
          {replaying && (
            <button className="quiet" onClick={() => (skip.current = true)}>
              Skip to the end
            </button>
          )}
          {!replaying && opening !== "loading" && (
            <>
              {stage === "flat" && <button onClick={() => record({ k: "fold" })}>Fold</button>}
              {stage === "trimming" && <button onClick={() => record({ k: "trim" })}>Trim</button>}
              {stage === "cutting" && anchors.length > 0 && (
                <>
                  <button
                    disabled={anchors.length < 3}
                    onClick={() => {
                      record({ k: "cut", tool, pts: penCut(anchors) });
                      setAnchors([]);
                    }}
                  >
                    Cut
                  </button>
                  <button className="quiet" onClick={() => setAnchors([])}>
                    Cancel
                  </button>
                </>
              )}
              {stage === "cutting" && anchors.length === 0 && (
                <>
                  <button disabled={cuts === 0} onClick={() => record({ k: "unfold" })}>
                    Unfold
                  </button>
                  <button
                    className="quiet"
                    onClick={() => {
                      for (const c of randomCuts(3)) record({ k: "cut", tool: "surprise", pts: outlineCut(c) });
                    }}
                  >
                    Surprise me
                  </button>
                  <button className="quiet" disabled={cuts === 0} onClick={() => record({ k: "undo" })}>
                    Undo
                  </button>
                </>
              )}
              {stage === "open" && (
                <>
                  {save.state === "saved" ? (
                    <button onClick={() => copyLink(save.id)}>{save.copied ? "Link copied" : "Share link"}</button>
                  ) : (
                    <button disabled={save.state === "saving"} onClick={onSave}>
                      {save.state === "saving" ? "Saving…" : "Save"}
                    </button>
                  )}
                  {canReplay && (
                    <button className="quiet" onClick={() => replay(recorder.recording)}>
                      Replay
                    </button>
                  )}
                  <button className="quiet" onClick={() => record({ k: "refold" })}>
                    Fold back up
                  </button>
                  <button
                    className="quiet"
                    onClick={() => {
                      recorder.reset();
                      setSave({ state: "idle" });
                      setShared(false);
                      if (SHARED || save.state === "saved") history.replaceState(null, "", location.pathname);
                      newPaper();
                    }}
                  >
                    New paper
                  </button>
                </>
              )}
            </>
          )}
          {busy && !replaying && <span className="hint">…</span>}
        </div>
      </div>
    </div>
  );
}
