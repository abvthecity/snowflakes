// An invisible sheet over the folded paper that turns the pointer into cuts,
// with three tools:
//
//   freehand  press and draw a loop; letting go cuts it
//   straight  click corner after corner; click the first corner again to cut
//   curve     like straight, but press and drag to pull a corner into a curve
//
// A pen path in progress lives in App, so the panel's Cut and Cancel buttons
// can finish or drop it; Enter, Escape and Backspace do the same here.
import { Stroke } from "./Stroke";
import type { ThreeEvent } from "@react-three/fiber";
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { Vec2 } from "./folds";
import { outline, type Anchor } from "./penPath";
import { freehandCut, penCut } from "./timeline";

export type CutTool = "freehand" | "straight" | "curve";

/** How close, in paper widths, a click must land to the first corner to close the shape; a finger gets more room. */
const CLOSE_DISTANCE = 0.03;
const CLOSE_DISTANCE_TOUCH = 0.06;
const Z = 0.09;
const RED = "#e2483d";

const lift = (points: readonly Vec2[], z = Z) => points.map(([x, y]) => [x, y, z] as [number, number, number]);
const dist = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function Dot({ at, size = 0.009, color = RED }: { at: Vec2; size?: number; color?: string }) {
  return (
    <mesh position={[at[0], at[1], Z + 0.001]}>
      <circleGeometry args={[size, 20]} />
      <meshBasicMaterial color={color} depthTest={false} />
    </mesh>
  );
}

export function CuttingBoard({
  tool,
  anchors,
  setAnchors,
  onCut,
}: {
  tool: CutTool;
  anchors: Anchor[];
  setAnchors: Dispatch<SetStateAction<Anchor[]>>;
  /** A finished cut with the current tool, as the timeline records it (see timeline.ts). */
  onCut: (pts: number[]) => void;
}) {
  const [stroke, setStroke] = useState<Vec2[]>([]);
  const times = useRef<number[]>([]);
  const [hover, setHover] = useState<Vec2 | null>(null);
  const drawing = useRef(false);
  const dragging = useRef(false);

  const finishPen = () => {
    if (anchors.length > 2) onCut(penCut(anchors));
    setAnchors([]);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (tool === "freehand" || (e.target as Element | null)?.closest?.("button, input")) return;
      if (e.key === "Enter") finishPen();
      else if (e.key === "Escape") setAnchors([]);
      else if (e.key === "Backspace") setAnchors((a) => a.slice(0, -1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const pointOf = (e: ThreeEvent<PointerEvent>): Vec2 => [e.point.x, e.point.y];

  const down = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const p = pointOf(e);
    if (tool === "freehand") {
      drawing.current = true;
      times.current = [performance.now()];
      setStroke([p]);
      return;
    }
    const reach = e.pointerType === "touch" ? CLOSE_DISTANCE_TOUCH : CLOSE_DISTANCE;
    if (anchors.length > 2 && dist(p, anchors[0].point) < reach) {
      finishPen();
      return;
    }
    setAnchors((a) => [...a, { point: p, handle: [0, 0], at: performance.now() }]);
    dragging.current = tool === "curve";
  };

  const move = (e: ThreeEvent<PointerEvent>) => {
    const p = pointOf(e);
    setHover(p);
    if (tool === "freehand") {
      if (!drawing.current) return;
      setStroke((s) => {
        const last = s[s.length - 1];
        if (last && dist(p, last) < 0.006) return s;
        times.current = [...times.current.slice(0, s.length), performance.now()];
        return [...s, p];
      });
      return;
    }
    if (dragging.current) {
      setAnchors((a) => {
        if (!a.length) return a;
        const last = a[a.length - 1];
        const handle: Vec2 = [p[0] - last.point[0], p[1] - last.point[1]];
        return [...a.slice(0, -1), { ...last, handle }];
      });
    }
  };

  const up = () => {
    dragging.current = false;
    if (!drawing.current) return;
    drawing.current = false;
    setStroke((s) => {
      if (s.length > 2) onCut(freehandCut(s, times.current));
      return [];
    });
  };

  const pen = tool !== "freehand" && anchors.length > 0;
  const path = pen ? outline(anchors, false) : [];
  const last = anchors[anchors.length - 1];
  const closing = pen && hover && anchors.length > 2 && dist(hover, anchors[0].point) < CLOSE_DISTANCE;

  return (
    <>
      <mesh
        position={[0, 0.6, 0.08]}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerLeave={() => {
          setHover(null);
          up();
        }}
      >
        <planeGeometry args={[6, 6]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {stroke.length > 1 && (
        <Stroke points={lift([...stroke, stroke[0]])} color={RED} lineWidth={2.5} dashed dashSize={0.02} gapSize={0.012} />
      )}

      {pen && (
        <>
          {path.length > 1 && <Stroke points={lift(path)} color={RED} lineWidth={2.5} />}
          {/* Where the next segment will go: to the pointer, or back to the start to close. */}
          {hover && !dragging.current && (
            <Stroke
              points={lift([last.point, closing ? anchors[0].point : hover])}
              color={RED}
              lineWidth={1.5}
              dashed
              dashSize={0.015}
              gapSize={0.01}
            />
          )}
          {anchors.map((a, i) => (
            <Dot key={i} at={a.point} size={i === 0 ? (closing ? 0.016 : 0.012) : 0.009} color={i === 0 ? "#ffffff" : RED} />
          ))}
          {tool === "curve" && (last.handle[0] || last.handle[1]) ? (
            <>
              <Stroke
                points={lift([
                  [last.point[0] - last.handle[0], last.point[1] - last.handle[1]],
                  [last.point[0] + last.handle[0], last.point[1] + last.handle[1]],
                ])}
                color="#9fb3e8"
                lineWidth={1}
              />
              <Dot at={[last.point[0] + last.handle[0], last.point[1] + last.handle[1]]} size={0.007} color="#9fb3e8" />
              <Dot at={[last.point[0] - last.handle[0], last.point[1] - last.handle[1]]} size={0.007} color="#9fb3e8" />
            </>
          ) : null}
        </>
      )}
    </>
  );
}
