// Paper for the WebGPU renderer. The surface itself (fibres, the cloudy
// formation of the pulp, crease ridges and furrows) is WGSL in paper.wgsl,
// brought into three.js's node system with vgpu's `tslExports()`. The node
// material does the rest: lighting, light coming through the thin sheet,
// and the cut-out mask.
import * as THREE from "three/webgpu";
import type { LightingModelDirectInput, Node, NodeBuilder } from "three/webgpu";
import {
  abs,
  diffuseColor,
  faceDirection,
  float,
  fwidth,
  length,
  max,
  mix,
  normalView,
  positionView,
  sign,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
} from "three/tsl";
import { tslExports } from "vgpu/three";
import paperModule from "./paper.wgsl";
import { CONTACT_SHADE, EDGE_SHADE } from "./paperShading";

type PaperExports = {
  paperSurface: { p: Node; footprint: Node; crease: Node | number; facing: Node; start: Node };
  foldShading: Record<"p" | "footprint" | "facing" | "start" | `folds${0 | 1 | 2}` | `contact${0 | 1 | 2 | 3 | 4 | 5}`, Node>;
};

const { paperSurface, foldShading } = tslExports<PaperExports>(paperModule)("paperSurface", "foldShading");

/**
 * Physical lighting, plus the light that comes through the sheet. Paper is
 * thin enough that light striking its back scatters out of its front as a
 * soft diffuse glow, so each light also lights the side facing away from it,
 * dimmed by `transmittance`.
 */
type Vec3Node = Node<"vec3">;

class PaperLightingModel extends THREE.PhysicalLightingModel {
  constructor(private readonly transmittance: Vec3Node) {
    super(false, true);
  }

  direct(input: LightingModelDirectInput, builder: NodeBuilder) {
    const { lightDirection, lightColor, reflectedLight } = input;
    const through = normalView.dot(lightDirection as Vec3Node).negate().clamp();
    const glow = vec3(lightColor as Vec3Node).mul(through).mul(this.transmittance).mul(diffuseColor.rgb).mul(1 / Math.PI);
    (reflectedLight.directDiffuse as Vec3Node).addAssign(glow);
    super.direct(input, builder);
  }
}

class PaperMaterial extends THREE.MeshPhysicalNodeMaterial {
  /** 0 while the paper has never been folded, up to 1 once it is folded and opened again. */
  readonly crease = uniform(0);
  /** The sheet's colour (see paperColours.ts); white by default. */
  readonly tint = uniform(new THREE.Color("#fcfcfa"));
  /** The angle of the first crease line; see FoldMethod.sectors. */
  readonly creaseStart = uniform(0);
  /** How far each crease is folded, signed by which way: see foldShading in paper.wgsl, and Paper.tsx. */
  readonly folds = Array.from({ length: 3 }, () => uniform(new THREE.Vector4()));
  /** Where flaps lie on each sector's creases, signed by which side: see foldShading in paper.wgsl, and Paper.tsx. */
  readonly contact = Array.from({ length: 6 }, () => uniform(new THREE.Vector4()));
  transmittanceNode: Vec3Node = vec3(0);

  setupLightingModel() {
    return new PaperLightingModel(this.transmittanceNode);
  }
}

export type PaperNodeMaterial = PaperMaterial;

export function createPaperNodeMaterial(mask: THREE.Texture): PaperNodeMaterial {
  // Alpha to coverage turns the mask's edge into multisample coverage, so the
  // cut outlines come out as smooth as the sheet's own edges instead of stepped.
  const material = new PaperMaterial({ side: THREE.DoubleSide, alphaTest: 0.5, alphaToCoverage: true });
  const { crease, tint, creaseStart: start, folds, contact } = material;

  // Where this point lies on the flat sheet, and how much sheet one pixel covers.
  const p = uv().mul(2).sub(1);
  const footprint = length(fwidth(p));
  const surface = paperSurface({ p, footprint, crease, facing: faceDirection, start });
  const [folds0, folds1, folds2] = folds;
  const [contact0, contact1, contact2, contact3, contact4, contact5] = contact;
  const folding = foldShading({
    p,
    footprint,
    facing: faceDirection,
    start,
    folds0,
    folds1,
    folds2,
    contact0,
    contact1,
    contact2,
    contact3,
    contact4,
    contact5,
  });
  const height = surface.x.add(folding.x);
  const formation = surface.y;
  const albedo = surface.z;
  const shade = surface.w;

  // Three ramps alpha to coverage from alphaTest up across one pixel's worth
  // of change; start it half a pixel early, so the ramp is centred on the cut.
  const cut = texture(mask, uv()).r;
  material.opacityNode = cut;
  material.alphaTestNode = float(0.5).sub(fwidth(cut).mul(0.5));

  // The sheet's edges, cut or square, show as a fine darker line, as a paper
  // edge does lying on paper: the layer under it is the same colour, so the
  // line is what tells where one ends. A few taps of the mask around the
  // point tell how near a cut is.
  const reach = max(float(0.0025), footprint.mul(1.2));
  const tap = reach.mul(0.5);
  const inside = texture(mask, uv().add(vec2(tap, 0)))
    .r.add(texture(mask, uv().sub(vec2(tap, 0))).r)
    .add(texture(mask, uv().add(vec2(0, tap))).r)
    .add(texture(mask, uv().sub(vec2(0, tap))).r)
    .mul(0.25);
  const toSquare = float(1).sub(max(abs(p.x), abs(p.y))).div(reach).clamp();
  const edge = max(float(1).sub(inside).mul(2).clamp(), float(1).sub(toSquare));

  // The sheet's colour, mottled by the pulp; creases hold a little shadow in their furrows.
  material.colorNode = tint
    .mul(albedo)
    .mul(float(1).sub(shade.mul(0.07)))
    .mul(float(1).sub(edge.mul(EDGE_SHADE)))
    .mul(float(1).sub(folding.y.mul(CONTACT_SHADE)));
  material.roughnessNode = float(0.8).add(formation.mul(0.12));
  material.sheen = 0.3;
  material.sheenRoughness = 0.65;
  material.sheenColor = new THREE.Color("#ffffff");

  // Bump from the height field. Unlike three's bumpMap, this keeps the height
  // in world units (the sheet is 2 units across), so the fibres and creases
  // stand the same height at any zoom. Mikkelsen, "Bump Mapping Unparametrized
  // Surfaces on the GPU", listing 1.
  const dpdx = positionView.dFdx();
  const dpdy = positionView.dFdy();
  const r1 = dpdy.cross(normalView);
  const r2 = normalView.cross(dpdx);
  const det = dpdx.dot(r1).mul(faceDirection);
  const grad = sign(det).mul(height.dFdx().mul(r1).add(height.dFdy().mul(r2)));
  material.normalNode = abs(det).mul(normalView).sub(grad).normalize();

  // Light from behind comes through warmed, and patchy: the thin spots of
  // the formation let more through, as when paper is held to a window. It
  // crosses the dyed fibres on its way, so a coloured sheet glows deeper.
  material.transmittanceNode = vec3(1.0, 0.95, 0.86).mul(mix(float(0.55), float(0.3), formation)).mul(tint);

  return material;
}
