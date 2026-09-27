// The geometry of folding a square of paper diagonally four times.
//
// The paper is the square [-1, 1]² in the XY plane. Every fold line passes
// through its centre, so the paper splits into 16 triangular sectors of 22.5°
// each, and every fold maps whole sectors onto whole sectors:
//
//   fold 1  along the diagonal y = x          (45°)    square   → triangle
//   fold 2  along the other diagonal y = -x   (135°)   triangle → quarter
//   fold 3  along the vertical centre line    (90°)    quarter  → eighth
//   fold 4  bisecting that                    (112.5°) eighth   → 16th
//
// What stays put is the thin wedge between 90° and 112.5°, pointing down at
// the centre with the top edge of the square across its wide end. That is
// the folded paper you cut.

export type Vec2 = readonly [number, number];
/** A 2×2 linear map, row-major: [a, b, c, d] maps (x, y) to (ax + by, cx + dy). */
export type Mat2 = readonly [number, number, number, number];

const DEG = Math.PI / 180;

export const SECTOR_COUNT = 16;
export const SECTOR_ANGLE = 22.5 * DEG;

/** Fold line directions, in the order the paper is folded. */
export const FOLD_ANGLES = [45 * DEG, 135 * DEG, 90 * DEG, 112.5 * DEG] as const;

/** A direction inside the wedge that never moves; decides which side of each fold is kept. */
const KEPT_DIRECTION: Vec2 = [Math.cos(101.25 * DEG), Math.sin(101.25 * DEG)];

export const IDENTITY: Mat2 = [1, 0, 0, 1];

export function mul(m: Mat2, n: Mat2): Mat2 {
  return [
    m[0] * n[0] + m[1] * n[2],
    m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2],
    m[2] * n[1] + m[3] * n[3],
  ];
}

export function apply(m: Mat2, p: Vec2): Vec2 {
  return [m[0] * p[0] + m[1] * p[1], m[2] * p[0] + m[3] * p[1]];
}

/** Reflection across the line through the origin at angle `a`. */
export function reflection(a: number): Mat2 {
  const c = Math.cos(2 * a);
  const s = Math.sin(2 * a);
  return [c, s, s, -c];
}

/** Positive when `p` lies to the left of the line through the origin at angle `a`. */
export function side(a: number, p: Vec2): number {
  return Math.cos(a) * p[1] - Math.sin(a) * p[0];
}

/** Where the ray from the centre at angle `t` leaves the square. */
function squareEdge(t: number): Vec2 {
  const c = Math.cos(t);
  const s = Math.sin(t);
  const k = 1 / Math.max(Math.abs(c), Math.abs(s));
  return [c * k, s * k];
}

export interface Sector {
  index: number;
  /** The sector's triangle in the flat, unfolded square: centre, then two edge points. */
  triangle: readonly [Vec2, Vec2, Vec2];
  /** For each fold, whether this sector is on the side that moves. */
  moves: readonly boolean[];
  /** Maps a point of this sector in the flat square to where it lies once folded. */
  folded: Mat2;
  /** Its stacking order after each fold (0 = bottom), starting with the flat sheet. */
  layers: readonly number[];
}

function buildSectors(): Sector[] {
  const base = Array.from({ length: SECTOR_COUNT }, (_, i) => {
    const t0 = i * SECTOR_ANGLE;
    const t1 = (i + 1) * SECTOR_ANGLE;
    const mid = (i + 0.5) * SECTOR_ANGLE;
    return {
      index: i,
      triangle: [[0, 0], squareEdge(t0), squareEdge(t1)] as const,
      probe: [Math.cos(mid), Math.sin(mid)] as Vec2,
      moves: [] as boolean[],
      folded: IDENTITY,
      layers: [0],
    };
  });

  let height = 1;
  for (const a of FOLD_ANGLES) {
    const keptSide = Math.sign(side(a, KEPT_DIRECTION));
    for (const s of base) {
      const now = apply(s.folded, s.probe);
      const moving = Math.sign(side(a, now)) !== keptSide;
      s.moves.push(moving);
      const layer = s.layers[s.layers.length - 1];
      // A folded-over flap lands on top of what stays, upside down.
      s.layers.push(moving ? 2 * height - 1 - layer : layer);
      if (moving) s.folded = mul(reflection(a), s.folded);
    }
    height *= 2;
  }
  return base.map(({ probe: _, ...s }) => s);
}

export const SECTORS: readonly Sector[] = buildSectors();

/**
 * Which way to turn each fold's flap about its line so that it lifts toward
 * +z (the viewer) on its way over, rather than through the table.
 */
export const FOLD_LIFT: readonly number[] = FOLD_ANGLES.map((a) => -Math.sign(side(a, KEPT_DIRECTION)));

/** The inverse of a product of reflections is the same product, reversed; for a 2×2 we just invert. */
export function invert(m: Mat2): Mat2 {
  const det = m[0] * m[3] - m[1] * m[2];
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det];
}
