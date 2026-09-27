// The paper's surface, as pure functions of where a point lies on the flat,
// unfolded sheet (p in [-1, 1]², one unit is about 10 cm of paper). Three.js
// calls these from the paper's node material through vgpu's `tslExports()`,
// so every sector samples the same sheet, wherever the folds have taken it.

import { hash3 } from "@vgpu/wgsl-std/hash";
import { fbmSimplex2d, simplex2d } from "@vgpu/wgsl-std/noise/simplex";

const TAU = 6.2831853;
/** Crease lines run from the centre every 30°; they are the sector edges. Where they start depends on the fold method. */
const CREASE_STEP = 0.5235988;

fn segmentDistance(p: vec2f, a: vec2f, b: vec2f) -> f32 {
  let pa = p - a;
  let ba = b - a;
  let h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}

/**
 * One scale of fibres: each grid cell scatters two short, slightly bent
 * strands, some standing proud of the pulp and some pressed into it.
 * `footprint` is how much paper one pixel covers; strands thinner than that
 * widen and flatten, so they fade into an even texture instead of shimmering.
 */
fn fibreLayer(p: vec2f, scale: f32, seed: f32, footprint: f32) -> f32 {
  let q = p * scale;
  let cell = floor(q);
  let halfWidth = 0.05;
  let soft = max(halfWidth, footprint * scale * 0.75);
  let weight = halfWidth / soft;
  var sum = 0.0;
  for (var j = -1; j <= 1; j = j + 1) {
    for (var i = -1; i <= 1; i = i + 1) {
      let c = cell + vec2f(f32(i), f32(j));
      for (var k = 0; k < 2; k = k + 1) {
        let h = hash3(vec3f(c, seed + f32(k) * 17.0));
        let g = hash3(vec3f(c.yx, seed + f32(k) * 31.0 + 5.0));
        let centre = c + h.xy;
        let angle = h.z * TAU;
        let along = vec2f(cos(angle), sin(angle)) * (0.35 + 0.55 * g.x);
        let bend = vec2f(-along.y, along.x) * (g.y - 0.5) * 0.7;
        let d = min(
          segmentDistance(q, centre - along, centre + bend),
          segmentDistance(q, centre + bend, centre + along),
        );
        let ridge = 1.0 - smoothstep(0.0, soft, d);
        sum = sum + ridge * weight * select(-0.6, 1.0, g.z > 0.4);
      }
    }
  }
  return sum;
}

/** Signed distance across the nearest crease line, and whether it is a mountain (+1) or a valley (-1). */
fn nearestCrease(p: vec2f, start: f32) -> vec2f {
  let r = length(p);
  let a = atan2(p.y, p.x) - start;
  let k = round(a / CREASE_STEP);
  let offset = a - k * CREASE_STEP;
  // Rays alternate: odd ones ride up toward the viewer, even ones sink (see Paper.tsx).
  let ki = (i32(k) % 12 + 12) % 12;
  let kind = select(-1.0, 1.0, ki % 2 == 1);
  return vec2f(r * sin(offset), kind);
}

/**
 * Everything the material needs about a point of paper, in one call:
 *   x  surface height, for bump mapping (fibres, crease ridges and furrows)
 *   y  formation: the cloudy clumping of pulp, 0 thin to 1 thick
 *   z  albedo, around 1
 *   w  how much a crease shades this point (0 none, 1 the bottom of a furrow)
 * `crease` runs 0 (never folded) to 1 (freshly unfolded). `facing` is 1 on
 * the front of the sheet and -1 on the back, where mountains become valleys.
 * `start` is the angle of the first crease line.
 */
export fn paperSurface(p: vec2f, footprint: f32, crease: f32, facing: f32, start: f32) -> vec4f {
  let formation = clamp(fbmSimplex2d(p * 14.0 + vec2f(3.1, 7.7), 5, 2.03, 0.55) * 0.9 + 0.5, 0.0, 1.0);

  let fibres = fibreLayer(p, 55.0, 1.0, footprint) * 0.7 + fibreLayer(p, 130.0, 2.0, footprint) * 0.45;
  // The finest grain only where a pixel is small enough to resolve it.
  let pulp = simplex2d(p * 420.0) * 0.25 * (1.0 - smoothstep(0.6, 1.5, footprint * 420.0));
  // Heights in sheet units (10 cm): fibres stand some 25 µm proud, about
  // what a sheet of copy paper's roughness comes to.
  var height = (fibres + pulp) * 0.00025 + formation * 0.00005;

  // A crease is a narrow, rounded ridge or furrow in the sheet. Keep its
  // slope, not its height, as it widens to at least a pixel or so.
  let nearest = nearestCrease(p, start) * vec2f(1.0, facing);
  let width = max(0.006, footprint * 1.5);
  let profile = exp(-(nearest.x * nearest.x) / (width * width));
  // Near the centre every crease meets; let them fade out rather than pile up.
  let reach = smoothstep(0.02, 0.12, length(p));
  height = height + nearest.y * profile * width * 0.6 * crease * reach;
  let shade = profile * crease * reach * select(0.35, 1.0, nearest.y < 0.0);

  let albedo = 1.0 + (fibres * 0.025 + pulp * 0.03) - (formation - 0.5) * 0.035;
  return vec4f(height, formation, albedo, shade);
}

/**
 * What shows where the paper is folded over on itself, at `p`:
 *   x  the height of the roll (along the sheet's front) where the paper turns
 *      back on itself: it doesn't fold on a knife edge but rolls round in a
 *      tight curve, which catches the light on one side and falls into shade
 *      on the other
 *   y  a soft contact shadow, 0 to 1, where the rolled edge of a flap lies on
 *      this layer
 *
 * Crease k runs from the centre at `start` + k·30°, between sectors k - 1
 * and k. `folds` holds, for crease k, component k % 4 of vector k / 4: how
 * far it is folded, 0 open to 1 flat back on itself, signed by the side it
 * folds toward (+1 the front). `contact` holds, for sector i, entry 2i for
 * the flap edge lying along its crease i and 2i + 1 for crease i + 1: how
 * strongly it shades this sector, signed by the side the flap lies on.
 * `facing` is 1 on the front of the sheet and -1 on the back. Both keep at
 * least a few pixels wide, so they read at any zoom.
 */
export fn foldShading(
  p: vec2f,
  footprint: f32,
  facing: f32,
  start: f32,
  folds0: vec4f,
  folds1: vec4f,
  folds2: vec4f,
  contact0: vec4f,
  contact1: vec4f,
  contact2: vec4f,
  contact3: vec4f,
  contact4: vec4f,
  contact5: vec4f,
) -> vec2f {
  var folds = array<f32, 12>(
    folds0.x, folds0.y, folds0.z, folds0.w,
    folds1.x, folds1.y, folds1.z, folds1.w,
    folds2.x, folds2.y, folds2.z, folds2.w,
  );
  var contacts = array<vec4f, 6>(contact0, contact1, contact2, contact3, contact4, contact5);
  let r = length(p);
  var a = atan2(p.y, p.x) - start;
  a = a - floor(a / TAU) * TAU;
  let k = min(i32(a / CREASE_STEP), 11);
  let offset = a - f32(k) * CREASE_STEP;
  // Distance to either edge of this point's sector.
  let toNear = r * sin(offset);
  let toFar = r * sin(CREASE_STEP - offset);

  let roll = max(0.014, footprint * 4.0);
  let rollNear = 1.0 - clamp(toNear / roll, 0.0, 1.0);
  let rollFar = 1.0 - clamp(toFar / roll, 0.0, 1.0);
  // Every fold meets at the centre; fade the roll out there rather than let them pile up.
  let reach = smoothstep(0.01, 0.08, r);
  let height = roll * reach * (folds[k] * rollNear * rollNear + folds[(k + 1) % 12] * rollFar * rollFar);

  let pair = select(contacts[k / 2].xy, contacts[k / 2].zw, k % 2 == 1) * facing;
  let spread = max(0.045, footprint * 10.0);
  let shadowNear = 1.0 - clamp(toNear / spread, 0.0, 1.0);
  let shadowFar = 1.0 - clamp(toFar / spread, 0.0, 1.0);
  let shadow = max(max(pair.x, 0.0) * shadowNear * shadowNear, max(pair.y, 0.0) * shadowFar * shadowFar);
  return vec2f(height, shadow);
}
