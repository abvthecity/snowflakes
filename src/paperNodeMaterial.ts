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
  mix,
  normalView,
  positionView,
  select,
  sign,
  texture,
  uniform,
  uv,
  vec3,
} from "three/tsl";
import { tslExports } from "vgpu/three";
import paperModule from "./paper.wgsl";

type PaperExports = {
  paperSurface: { p: Node; footprint: Node; crease: Node | number; facing: Node };
};

const { paperSurface } = tslExports<PaperExports>(paperModule)("paperSurface");

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
  transmittanceNode: Vec3Node = vec3(0);

  setupLightingModel() {
    return new PaperLightingModel(this.transmittanceNode);
  }
}

export type PaperNodeMaterial = PaperMaterial;

/**
 * The paper is opaque and stops half a pixel inside each cut; the pixel
 * straddling the cut is left to the fringe (createFringeNodeMaterial), which
 * blends it over whatever lies behind, so the outlines come out smooth. Alpha
 * to coverage would do both in one pass, but GPUs dither it, and on a sharp
 * display the dither shows as speckles along every edge.
 */
export function createPaperNodeMaterial(mask: THREE.Texture): PaperNodeMaterial {
  const material = new PaperMaterial({ side: THREE.DoubleSide });
  const { crease, tint } = material;

  // Where this point lies on the flat sheet, and how much sheet one pixel covers.
  const p = uv().mul(2).sub(1);
  const footprint = length(fwidth(p));
  const surface = paperSurface({ p, footprint, crease, facing: faceDirection });
  const height = surface.x;
  const formation = surface.y;
  const albedo = surface.z;
  const shade = surface.w;

  const { cut, rim } = cutEdge(mask);
  material.opacityNode = cut;
  material.alphaTestNode = float(0.5).add(rim);

  // The sheet's colour, mottled by the pulp; creases hold a little shadow in their furrows.
  material.colorNode = tint.mul(albedo).mul(float(1).sub(shade.mul(0.07)));
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

/** The mask at this point, and half the change in it across one pixel. */
function cutEdge(mask: THREE.Texture) {
  const cut = texture(mask, uv()).r;
  return { cut, rim: fwidth(cut).mul(0.5) };
}

/**
 * The soft outer pixel of every cut edge: how much of the pixel the paper
 * covers, where the paper material leaves it out. Shaded plainly, since it is
 * never more than a pixel wide, and drawn after everything opaque, so it
 * blends over whatever lies behind the cut.
 */
export function createFringeNodeMaterial(mask: THREE.Texture) {
  const material = new THREE.MeshLambertNodeMaterial({ side: THREE.DoubleSide, transparent: true, depthWrite: false });
  const { cut, rim } = cutEdge(mask);
  // The mask ramps across the cut; stretched to span one pixel, centred on the cut.
  const cover = cut.sub(0.5).div(rim.mul(2).max(1e-5)).add(0.5).clamp();
  material.opacityNode = select(cut.greaterThanEqual(float(0.5).add(rim)), float(0), cover);
  material.alphaTest = 0.002;
  return material;
}
