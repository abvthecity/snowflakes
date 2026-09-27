// The geometry of folding a square of paper into a six-pointed snowflake.
//
// The paper is the square [-1, 1]² in the XY plane. Every fold line passes
// through its centre, so the paper splits into 12 triangular sectors of 30°
// each, and every fold maps whole sectors onto whole sectors:
//
//   fold 1  along the diagonal y = x         (45°)   square   → triangle
//   fold 2  in half, along y = -x            (135°)  triangle → quarter (90°)
//   fold 3  one side across, at 105°         ┐ the cone: the quarter
//   fold 4  the other side across, at 75°    ┘ folded in thirds (30°)
//
// What stays put is the 30° wedge between 75° and 105°, standing straight up
// from the centre. Twelve layers of mirror images make six-fold symmetry,
// and trimming the wedge's top along TRIM_LINE opens into a hexagon.

export type Vec2 = readonly [number, number];
/** A 2×2 linear map, row-major: [a, b, c, d] maps (x, y) to (ax + by, cx + dy). */
export type Mat2 = readonly [number, number, number, number];

const DEG = Math.PI / 180;

export const SECTOR_COUNT = 12;
export const SECTOR_ANGLE = 30 * DEG;
/** Sector boundaries run from here in SECTOR_ANGLE steps; every square corner lands on one. */
const SECTOR_START = 45 * DEG;

/** Fold line directions, in the order the paper is folded. */
export const FOLD_ANGLES = [45 * DEG, 135 * DEG, 105 * DEG, 75 * DEG] as const;

/** The folded wedge, as the angles of its two edges. */
export const WEDGE = [75 * DEG, 105 * DEG] as const;

/** A direction inside the wedge that never moves; decides which side of each fold is kept. */
const KEPT_DIRECTION: Vec2 = [0, 1];

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

/** The point at distance `r` from the centre in direction `a`. */
export function polar(r: number, a: number): Vec2 {
  return [r * Math.cos(a), r * Math.sin(a)];
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
  /** Where it lies after each fold, starting with the flat sheet; the last is `folded`. */
  placed: readonly Mat2[];
}

function buildSectors(): Sector[] {
  const base = Array.from({ length: SECTOR_COUNT }, (_, i) => {
    const t0 = SECTOR_START + i * SECTOR_ANGLE;
    const mid = t0 + SECTOR_ANGLE / 2;
    return {
      index: i,
      triangle: [[0, 0], squareEdge(t0), squareEdge(t0 + SECTOR_ANGLE)] as const,
      probe: polar(1, mid),
      moves: [] as boolean[],
      folded: IDENTITY,
      layers: [0],
      placed: [IDENTITY],
    };
  });

  for (const a of FOLD_ANGLES) {
    const keptSide = Math.sign(side(a, KEPT_DIRECTION));
    const moving = base.map((s) => Math.sign(side(a, apply(s.folded, s.probe))) !== keptSide);
    const top = (m: boolean) =>
      Math.max(-1, ...base.filter((_, i) => moving[i] === m).map((s) => s.layers[s.layers.length - 1]));
    // A folded-over flap lands upside down on top of the stack that stays.
    // Folding in thirds moves a third, not a half, so count the actual stacks.
    const keptTop = top(false);
    const movingTop = top(true);
    base.forEach((s, i) => {
      const layer = s.layers[s.layers.length - 1];
      s.moves.push(moving[i]);
      s.layers.push(moving[i] ? keptTop + 1 + (movingTop - layer) : layer);
      if (moving[i]) s.folded = mul(reflection(a), s.folded);
      s.placed.push(s.folded);
    });
  }
  return base.map(({ probe: _, ...s }) => s);
}

export const SECTORS: readonly Sector[] = buildSectors();

/** Whether `p` lies inside (or on the edge of) the triangle `t`. */
function inTriangle(p: Vec2, t: readonly Vec2[]): boolean {
  const cross = (a: Vec2, b: Vec2) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  const d = [cross(t[0], t[1]), cross(t[1], t[2]), cross(t[2], t[0])];
  const eps = 1e-9;
  return d.every((x) => x >= -eps) || d.every((x) => x <= eps);
}

/** Which sides of a sector are hidden under the rest of its stack. */
export interface Cover {
  /** Some sector above it covers all of it, so it can't be seen from the front. */
  above: boolean;
  /** Some sector below it covers all of it, so it can't be seen from the back. */
  below: boolean;
}

/**
 * For each sector, what covers it after `stage` folds and all through the
 * next one. Sectors folded onto the same spot make a stack, and the flap of
 * the next fold turns over as one piece, so only sectors in the same piece
 * count. They differ only in how far out they reach, toward the square's
 * corners. Cuts go through every layer alike, so a hole never uncovers one.
 */
function coverAfter(stage: number): readonly Cover[] {
  const placed = SECTORS.map((s) => s.triangle.map((p) => apply(s.placed[stage], p)));
  const piece = (s: Sector) => {
    const [, a, b] = placed[s.index];
    const angle = Math.atan2(a[1] + b[1], a[0] + b[0]);
    return `${angle.toFixed(3)},${stage < FOLD_ANGLES.length && s.moves[stage]}`;
  };
  const covers = (over: Sector, s: Sector) =>
    piece(over) === piece(s) && placed[s.index].every((p) => inTriangle(p, placed[over.index]));
  return SECTORS.map((s) => ({
    above: SECTORS.some((o) => o.layers[stage] > s.layers[stage] && covers(o, s)),
    below: SECTORS.some((o) => o.layers[stage] < s.layers[stage] && covers(o, s)),
  }));
}

/** For each number of folds made, 0 to 4, each sector's `Cover`. */
export const COVER: readonly (readonly Cover[])[] = Array.from({ length: FOLD_ANGLES.length + 1 }, (_, i) =>
  coverAfter(i),
);

/**
 * Which way to turn each fold's flap about its line so that it lifts toward
 * +z (the viewer) on its way over, rather than through the table.
 */
export const FOLD_LIFT: readonly number[] = FOLD_ANGLES.map((a) => -Math.sign(side(a, KEPT_DIRECTION)));

/** The hexagon's circumradius: its corners reach this far from the centre. */
export const HEXAGON_RADIUS = 0.98;

/**
 * The slice across the top of the folded wedge (step 6 of the paper guide).
 * It runs from a hexagon corner on the 105° fold to the middle of a hexagon
 * side on the 75° fold, square to that fold, so the twelve mirrored layers
 * open into a regular hexagon.
 */
export const TRIM_LINE: readonly [Vec2, Vec2] = [
  polar(HEXAGON_RADIUS, WEDGE[1]),
  polar(HEXAGON_RADIUS * Math.cos(30 * DEG), WEDGE[0]),
];

/** Everything beyond TRIM_LINE, as a cut outline in wedge coordinates. */
export const TRIM_CUT: readonly Vec2[] = [
  TRIM_LINE[0],
  TRIM_LINE[1],
  polar(3, WEDGE[0] - 20 * DEG),
  polar(3, WEDGE[1] + 20 * DEG),
];

/** The inverse of a product of reflections is the same product, reversed; for a 2×2 we just invert. */
export function invert(m: Mat2): Mat2 {
  const det = m[0] * m[3] - m[1] * m[2];
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det];
}
