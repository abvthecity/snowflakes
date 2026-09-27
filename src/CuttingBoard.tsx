// An invisible sheet over the folded paper that turns the pointer into cuts,
// with one pair of scissors:
//
//   tap        drop a corner; corners join with straight lines
//   drag       draw freehand; when the finger lifts, the stroke is smoothed
//              into a few curves, which join on to any corners before it
//   tap the first point (or a drag that ends on it) closes the shape and cuts
//
// Taps and drags mix freely in one shape. Until the next cut starts, the last
// one stays editable: drag a point or a curve handle to reshape it, or tap a
// point to round or sharpen it. That works on a shape in progress too.
//
// While a shape is open, the piece it would cut away shows faded
// (CutPreview), closed back to the first point from the pointer on desktop,
// or from the last point by touch.
//
// The path lives in App, so the panel's Cut and Cancel buttons can finish or
// drop it; Enter, Escape and Backspace do the same here.
import type { ThreeEvent } from "@react-three/fiber";
import { useThree } from "@react-three/fiber";
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import * as THREE from "three";
import { CutPreview } from "./CutPreview";
import type { CutMask } from "./cuts";
import type { Vec2 } from "./folds";
import { fitStroke, isSmooth, outline, toggleSmooth, type Anchor } from "./penPath";
import { Stroke } from "./Stroke";

/**
 * The shape being cut. Open, it is still being drawn. Closed, it has been cut
 * (it is the paper's last cut) and can still be reshaped.
 */
export interface CutPath {
  anchors: Anchor[];
  closed: boolean;
}
export const NO_PATH: CutPath = { anchors: [], closed: false };

/** How close, in CSS pixels, a press must land to grab a point or handle; a finger gets more room. */
const REACH = 12;
const REACH_TOUCH = 24;
/** How far, in CSS pixels, a press must move before it is a drag rather than a tap. */
const SLOP = 5;
const SLOP_TOUCH = 10;
/** How far, in CSS pixels, a smoothed stroke may stray from the drawn one. */
const SMOOTHING = 2.5;
const SMOOTHING_TOUCH = 5;
const Z = 0.09;
const RED = "#e2483d";
const BLUE = "#9fb3e8";

const lift = (points: readonly Vec2[], z = Z) => points.map(([x, y]) => [x, y, z] as [number, number, number]);
const dist = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const add = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]];
const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];

/** Which part of which anchor a press landed on: its point, or the end of its outgoing (1) or incoming (-1) handle. */
interface Hit {
  index: number;
  part: 0 | 1 | -1;
}

type Gesture =
  | { kind: "press"; id: number; at: Vec2; x: number; y: number; hit: Hit | null }
  | { kind: "stroke"; id: number; points: Vec2[]; since: number }
  | { kind: "drag"; id: number; hit: Hit };

function Dot({ at, size = 0.009, color = RED }: { at: Vec2; size?: number; color?: string }) {
  return (
    <mesh position={[at[0], at[1], Z + 0.001]}>
      <circleGeometry args={[size, 20]} />
      <meshBasicMaterial color={color} depthTest={false} />
    </mesh>
  );
}

export function CuttingBoard({
  path,
  setPath,
  mask,
  onClose,
  onLift,
}: {
  path: CutPath;
  setPath: Dispatch<SetStateAction<CutPath>>;
  /** The paper's cuts so far, so the preview leaves them clear. */
  mask: CutMask;
  /** Cut along the closed shape (and make it the path, closed). */
  onClose: (anchors: Anchor[]) => void;
  /** Take the last cut back off the paper while it is reshaped; `onClose` puts it back. */
  onLift: () => void;
}) {
  const camera = useThree((s) => s.camera);
  const height = useThree((s) => s.size.height);
  const gesture = useRef<Gesture | null>(null);
  const [stroke, setStroke] = useState<Vec2[]>([]);
  const [hover, setHover] = useState<Vec2 | null>(null);
  const [touch, setTouch] = useState(false);
  /** A closed shape being reshaped, and so off the paper for now. */
  const [lifted, setLifted] = useState(false);
  /** The point last pressed; its curve handles show, and can be pulled. */
  const [picked, setPicked] = useState<number | null>(null);

  // The wedge is seen head-on, so one CSS pixel is this many paper units everywhere on it.
  const perPixel = (2 * (camera.position.z - Z) * Math.tan(THREE.MathUtils.degToRad((camera as THREE.PerspectiveCamera).fov / 2))) / height;
  const reach = (touch ? REACH_TOUCH : REACH) * perPixel;
  const { anchors, closed } = path;
  // Handles show on the point last pressed and, with a mouse, the point nearest the pointer,
  // rather than on every point of a smoothed freehand loop at once.
  let near = -1;
  if (hover && !touch) {
    let best = reach * 3;
    anchors.forEach((a, i) => {
      if (dist(hover, a.point) < best) (best = dist(hover, a.point)), (near = i);
    });
  }
  const showsHandles = (i: number) => isSmooth(anchors[i]) && (i === picked || i === near);

  const close = (a: Anchor[]) => {
    if (a.length > 2) onClose(a);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as Element | null)?.closest?.("button, input")) return;
      if (e.key === "Enter" && !closed) close(anchors);
      else if (e.key === "Escape") setPath(NO_PATH);
      else if (e.key === "Backspace" && !closed) setPath((p) => ({ ...p, anchors: p.anchors.slice(0, -1) }));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const pointOf = (e: ThreeEvent<PointerEvent>): Vec2 => [e.point.x, e.point.y];

  /** The point or handle nearest `p` within reach, points first. */
  const hitTest = (p: Vec2): Hit | null => {
    let best: Hit | null = null;
    let nearest = reach;
    anchors.forEach((a, index) => {
      const parts: [Hit["part"], Vec2, number][] = [[0, a.point, 0.8]];
      if (showsHandles(index)) parts.push([1, add(a.point, a.handle), 1], [-1, sub(a.point, a.handle), 1]);
      for (const [part, at, weight] of parts) {
        const d = dist(p, at) * weight;
        if (d < nearest) {
          nearest = d;
          best = { index, part };
        }
      }
    });
    return best;
  };

  const down = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    if (gesture.current) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const isTouch = e.pointerType === "touch";
    setTouch(isTouch);
    if (isTouch) setHover(null);
    const at = pointOf(e);
    const hit = hitTest(at);
    if (hit?.part === 0) setPicked(hit.index);
    else if (!hit) setPicked(null);
    gesture.current = { kind: "press", id: e.pointerId, at, x: e.nativeEvent.clientX, y: e.nativeEvent.clientY, hit };
  };

  const move = (e: ThreeEvent<PointerEvent>) => {
    const p = pointOf(e);
    if (e.pointerType !== "touch") setHover(p);
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;

    if (g.kind === "press") {
      const slop = e.pointerType === "touch" ? SLOP_TOUCH : SLOP;
      if (Math.hypot(e.nativeEvent.clientX - g.x, e.nativeEvent.clientY - g.y) < slop) return;
      if (g.hit) {
        // Reshaping a finished cut: take it off the paper until the drag ends.
        if (closed && !lifted) {
          onLift();
          setLifted(true);
        }
        gesture.current = { kind: "drag", id: g.id, hit: g.hit };
      } else {
        // A new drag after a finished cut starts the next shape.
        if (closed) setPath(NO_PATH);
        gesture.current = { kind: "stroke", id: g.id, points: [g.at, p], since: performance.now() };
        setStroke([g.at, p]);
        return;
      }
    }

    const cur = gesture.current!;
    if (cur.kind === "stroke") {
      const last = cur.points[cur.points.length - 1];
      if (dist(p, last) < perPixel * 1.5) return;
      cur.points = [...cur.points, p];
      setStroke(cur.points);
    } else if (cur.kind === "drag") {
      const { index, part } = cur.hit;
      setPath((path) => ({
        ...path,
        anchors: path.anchors.map((a, i) => {
          if (i !== index) return a;
          if (part === 0) return { ...a, point: p };
          const off = sub(p, a.point);
          return { ...a, handle: part === 1 ? off : ([-off[0], -off[1]] as Vec2) };
        }),
      }));
    }
  };

  const up = (e: ThreeEvent<PointerEvent> | null) => {
    const g = gesture.current;
    if (!g || (e && g.id !== e.pointerId)) return;
    gesture.current = null;
    if (e?.pointerType === "touch") setHover(null);

    if (g.kind === "press") {
      if (!e) return;
      const { hit } = g;
      if (hit && hit.part === 0) {
        // Tapping the first point closes an open shape; tapping any other point rounds or sharpens it.
        if (!closed && hit.index === 0 && anchors.length > 2) close(anchors);
        else if (closed) {
          onLift();
          onClose(toggleSmooth(anchors, hit.index, true));
        } else setPath({ anchors: toggleSmooth(anchors, hit.index, false), closed: false });
      } else if (!hit) {
        const corner: Anchor = { point: g.at, handle: [0, 0], at: performance.now() };
        setPath(closed ? { anchors: [corner], closed: false } : { anchors: [...anchors, corner], closed: false });
      }
      return;
    }

    if (g.kind === "drag") {
      if (closed) {
        setLifted(false);
        onClose(anchors);
      }
      return;
    }

    // A freehand stroke: smooth it and join it on to the shape so far.
    setStroke([]);
    const base = closed ? [] : anchors;
    let pts = g.points;
    const start = base[0]?.point ?? pts[0];
    const ends = dist(pts[pts.length - 1], start) < reach;
    // Long enough to be a loop, rather than a short flick that never left the start.
    const loops = ends && (base.length > 1 || pts.length > 8);
    // Drop the tail that runs back over the start, so the loop closes cleanly.
    if (loops) while (pts.length > 3 && dist(pts[pts.length - 1], start) < reach / 2) pts = pts.slice(0, -1);
    const tolerance = (touch ? SMOOTHING_TOUCH : SMOOTHING) * perPixel;
    let fitted: Anchor[];
    if (loops && !base.length) fitted = fitStroke(pts, true, tolerance);
    else {
      fitted = fitStroke(pts, false, tolerance);
      // A stroke that starts on the last point carries on from it.
      if (base.length && dist(fitted[0].point, base[base.length - 1].point) < reach) fitted = fitted.slice(1);
      if (loops && fitted.length) fitted = fitted.slice(0, -1);
    }
    // Spread the fitted points over the time the stroke took, so a replay draws it at the same pace.
    const now = performance.now();
    fitted = fitted.map((a, i) => ({ ...a, at: g.since + ((now - g.since) * (i + 1)) / fitted.length }));
    const next = [...base, ...fitted];
    if (loops && next.length > 2) close(next);
    else setPath({ anchors: next, closed: false });
  };

  // What the shape would cut away if it were closed now.
  const last = anchors[anchors.length - 1];
  const drawing = stroke.length > 0;
  const aim = !closed && hover && !touch && !gesture.current ? hover : null;
  let shape: Vec2[] = [];
  if (drawing) shape = [...(closed ? [] : outline(anchors, false)), ...stroke];
  else if (closed) shape = lifted ? outline(anchors, true) : [];
  else if (aim && anchors.length > 1) shape = [...outline(anchors, false), aim];
  else if (anchors.length > 2) shape = outline(anchors, true);

  const closing = !closed && aim && anchors.length > 2 && dist(aim, anchors[0].point) < reach;
  const size = perPixel * (touch ? 5 : 4);

  return (
    <>
      <mesh
        position={[0, 0.6, 0.08]}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={() => up(null)}
        onPointerLeave={(e) => {
          setHover(null);
          if (gesture.current?.kind !== "press") up(e);
        }}
      >
        <planeGeometry args={[6, 6]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      <CutPreview shape={shape} mask={mask} z={Z - 0.004} />

      {drawing && (
        <Stroke
          points={lift(closed || !last ? stroke : [last.point, ...stroke])}
          color={RED}
          lineWidth={2.5}
          dashed
          dashSize={0.02}
          gapSize={0.012}
        />
      )}

      {anchors.length > 0 && !(closed && drawing) && (
        <>
          {anchors.length > 1 && (
            <Stroke points={lift(outline(anchors, closed))} color={RED} lineWidth={closed ? 1.5 : 2.5} />
          )}
          {/* Where the next segment will go: to the pointer, or back to the start to close. */}
          {aim && !drawing && (
            <Stroke
              points={lift([last.point, closing ? anchors[0].point : aim])}
              color={RED}
              lineWidth={1.5}
              dashed
              dashSize={0.015}
              gapSize={0.01}
            />
          )}
          {anchors.map((a, i) =>
            showsHandles(i) ? (
              <group key={`h${i}`}>
                <Stroke points={lift([sub(a.point, a.handle), add(a.point, a.handle)])} color={BLUE} lineWidth={1} />
                <Dot at={add(a.point, a.handle)} size={size * 0.75} color={BLUE} />
                <Dot at={sub(a.point, a.handle)} size={size * 0.75} color={BLUE} />
              </group>
            ) : null,
          )}
          {anchors.map((a, i) => (
            <Dot
              key={i}
              at={a.point}
              size={i === 0 && !closed ? size * (closing ? 1.8 : 1.35) : size}
              color={i === 0 && !closed ? "#ffffff" : RED}
            />
          ))}
        </>
      )}
    </>
  );
}
