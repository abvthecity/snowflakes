// The geometry of folding a square of paper into a six-pointed snowflake.
//
// The paper is the square [-1, 1]² in the XY plane. Every fold line passes
// through its centre, so the paper splits into 12 sectors of 30° each, and
// every fold maps whole sectors onto whole sectors. There is more than one
// way to get there; each FoldMethod lists its four fold lines.
//
// Diagonal (the paper guide):
//   fold 1  along the diagonal y = x         (45°)   square   → triangle
//   fold 2  in half, along y = -x            (135°)  triangle → quarter (90°)
//   fold 3  one side across, at 105°         ┐ the cone: the quarter
//   fold 4  the other side across, at 75°    ┘ folded in thirds (30°)
//
// In half first (the napkin guide):
//   fold 1  in half, along y = 0             (0°)    square   → rectangle
//   fold 2  the right side up, at 60°        ┐ the half folded
//   fold 3  the left side across, at 120°    ┘ in thirds (60°)
//   fold 4  in half again, at 90°            (90°)   → cone (30°)
//
// Either way, what stays put is a 30° wedge, twelve layers of mirror images
// that make six-fold symmetry. The napkin's wedge ends up at 90°–120°, so it
// turns a quarter of a sector as it folds, to stand straight up from the
// centre at 75°–105° like the other. Trimming the wedge's top along
// TRIM_LINE opens it into a hexagon.

export type Vec2 = readonly [number, number];
/** A 2×2 linear map, row-major: [a, b, c, d] maps (x, y) to (ax + by, cx + dy). */
export type Mat2 = readonly [number, number, number, number];

const DEG = Math.PI / 180;

export const SECTOR_COUNT = 12;
export const SECTOR_ANGLE = 30 * DEG;

/** The folded wedge, as the angles of its two edges, once it stands upright to be cut. */
export const WEDGE = [75 * DEG, 105 * DEG] as const;

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

/** Rotation by `a` about the origin. */
export function rotation(a: number): Mat2 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [c, -s, s, c];
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
  /**
   * The sector in the flat, unfolded square: the centre, then its outer edge
   * from one side to the other, taking in a square corner if one falls inside.
   */
  outline: readonly Vec2[];
  /** How far each point of the sector rises per unit of crease ridge: z = ridge · (x, y). */
  ridge: Vec2;
  /** For each fold, whether this sector is on the side that moves. */
  moves: readonly boolean[];
  /** Maps a point of this sector in the flat square to where it lies once folded (and turned upright). */
  folded: Mat2;
  /** Its stacking order after each fold (0 = bottom), starting with the flat sheet. */
  layers: readonly number[];
  /** Where it lies after each fold, starting with the flat sheet; the last is `folded`. */
  placed: readonly Mat2[];
}

/** Which sides of a sector are hidden under the rest of its stack. */
export interface Cover {
  /** Some sector above it covers all of it, so it can't be seen from the front. */
  above: boolean;
  /** Some sector below it covers all of it, so it can't be seen from the back. */
  below: boolean;
}

export interface FoldStep {
  title: string;
  body: string;
}

export interface FoldMethod {
  /** Stable id, for the URL (`?method=`) and saved snowflakes. */
  id: string;
  label: string;
  /** Fold line directions, in the order the paper is folded. */
  foldAngles: readonly number[];
  /** The step-by-step copy, one per fold. */
  steps: readonly FoldStep[];
  /** How far the finished cone turns during the last fold, to stand upright in WEDGE. */
  turn: number;
  /** From which fold on the paper is narrow enough for the close-up camera. */
  narrowAt: number;
  /** How the camera frames the paper between the first fold and narrowAt. */
  foldedView: "folded" | "halved";
  sectors: readonly Sector[];
  /** Which way to turn each fold's flap about its line, so it lifts toward +z (the viewer). */
  lift: readonly number[];
  /** For each number of folds made, 0 to 4, each sector's `Cover`. */
  cover: readonly (readonly Cover[])[];
}

function buildSectors(start: number, foldAngles: readonly number[], kept: Vec2, turn: number): Sector[] {
  const corners = [45, 135, 225, 315].map((a) => a * DEG);
  const base = Array.from({ length: SECTOR_COUNT }, (_, i) => {
    const t0 = start + i * SECTOR_ANGLE;
    const t1 = t0 + SECTOR_ANGLE;
    const inside = corners
      .map((c) => t0 + ((((c - t0) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)))
      .filter((c) => c > t0 + 1e-9 && c < t1 - 1e-9);
    const a = squareEdge(t0);
    const b = squareEdge(t1);
    // Alternate sectors lean their outer edges up and down: z is +|a| at one
    // side and -|b| at the other, a plane through the centre.
    const sign = i % 2 ? 1 : -1;
    const za = sign * Math.hypot(a[0], a[1]);
    const zb = -sign * Math.hypot(b[0], b[1]);
    const det = a[0] * b[1] - a[1] * b[0];
    const ridge: Vec2 = [(za * b[1] - zb * a[1]) / det, (zb * a[0] - za * b[0]) / det];
    return {
      index: i,
      outline: [[0, 0] as Vec2, a, ...inside.map(squareEdge), b],
      ridge,
      probe: polar(1, t0 + SECTOR_ANGLE / 2),
      moves: [] as boolean[],
      folded: IDENTITY,
      layers: [0],
      placed: [IDENTITY] as Mat2[],
    };
  });

  for (const a of foldAngles) {
    const keptSide = Math.sign(side(a, kept));
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
  return base.map(({ probe: _, ...s }) => {
    const folded = mul(rotation(turn), s.folded);
    return { ...s, folded, placed: [...s.placed.slice(0, -1), folded] };
  });
}

/** Whether `p` lies inside (or on the edge of) the convex polygon `poly`. */
function inConvex(p: Vec2, poly: readonly Vec2[]): boolean {
  const cross = (a: Vec2, b: Vec2) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  const d = poly.map((a, i) => cross(a, poly[(i + 1) % poly.length]));
  const eps = 1e-9;
  return d.every((x) => x >= -eps) || d.every((x) => x <= eps);
}

/**
 * For each sector, what covers it after `stage` folds and all through the
 * next one. Sectors folded onto the same spot make a stack, and the flap of
 * the next fold turns over as one piece, so only sectors in the same piece
 * count. They differ only in how far out they reach, toward the square's
 * corners. Cuts go through every layer alike, so a hole never uncovers one.
 */
function coverAfter(sectors: readonly Sector[], folds: number, stage: number): readonly Cover[] {
  const placed = sectors.map((s) => s.outline.map((p) => apply(s.placed[stage], p)));
  const piece = (s: Sector) => {
    const o = placed[s.index];
    const [a, b] = [o[1], o[o.length - 1]];
    const angle = Math.atan2(a[1] + b[1], a[0] + b[0]);
    return `${angle.toFixed(3)},${stage < folds && s.moves[stage]}`;
  };
  const covers = (over: Sector, s: Sector) =>
    piece(over) === piece(s) && placed[s.index].every((p) => inConvex(p, placed[over.index]));
  return sectors.map((s) => ({
    above: sectors.some((o) => o.layers[stage] > s.layers[stage] && covers(o, s)),
    below: sectors.some((o) => o.layers[stage] < s.layers[stage] && covers(o, s)),
  }));
}

function method(
  m: Omit<FoldMethod, "sectors" | "lift" | "cover"> & { sectorStart: number; kept: Vec2 },
): FoldMethod {
  const { sectorStart, kept, ...rest } = m;
  const sectors = buildSectors(sectorStart, m.foldAngles, kept, m.turn);
  return {
    ...rest,
    sectors,
    lift: m.foldAngles.map((a) => -Math.sign(side(a, kept))),
    cover: Array.from({ length: m.foldAngles.length + 1 }, (_, i) => coverAfter(sectors, m.foldAngles.length, i)),
  };
}

export const FOLD_METHODS: readonly FoldMethod[] = [
  method({
    id: "diagonal",
    label: "Corner to corner",
    sectorStart: 45 * DEG,
    foldAngles: [45 * DEG, 135 * DEG, 105 * DEG, 75 * DEG],
    // A direction inside the wedge that never moves; decides which side of each fold is kept.
    kept: [0, 1],
    turn: 0,
    narrowAt: 3,
    foldedView: "folded",
    steps: [
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
    ],
  }),
  method({
    id: "half",
    label: "In half first",
    sectorStart: 0,
    foldAngles: [0, 60 * DEG, 120 * DEG, 90 * DEG],
    kept: polar(1, 105 * DEG),
    turn: -15 * DEG,
    narrowAt: 4,
    foldedView: "halved",
    steps: [
      {
        title: "Fold in half",
        body: "Start with a square of paper. Fold the bottom up to the top, so the folded edge runs along the bottom.",
      },
      {
        title: "Fold up at 60°",
        body: "From the middle of the folded edge, fold the right side up and over, so its edge makes a 60° angle with the bottom.",
      },
      {
        title: "Fold the other side over",
        body: "Fold the left side across, onto the opposite edge, so the paper comes to a point six layers thick.",
      },
      {
        title: "Fold into a cone",
        body: "Fold the whole piece in half down the middle, making a narrow cone twelve layers thick.",
      },
    ],
  }),
];

export const DEFAULT_METHOD = FOLD_METHODS[0];

export function foldMethod(id: string | null | undefined): FoldMethod {
  return FOLD_METHODS.find((m) => m.id === id) ?? DEFAULT_METHOD;
}

/** The hexagon's circumradius: its corners reach this far from the centre. */
export const HEXAGON_RADIUS = 0.98;

/**
 * The slice across the top of the folded wedge. It runs from a hexagon
 * corner on the wedge's left edge to the middle of a hexagon side on its
 * right edge, square to that edge, so the twelve mirrored layers open into a
 * regular hexagon. The square's edges are at least 1 from the centre, so it
 * cuts through every layer whichever way the paper was folded.
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
