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
  transmittanceNode: Vec3Node = vec3(0);

  setupLightingModel() {
    return new PaperLightingModel(this.transmittanceNode);
  }
}

export type PaperNodeMaterial = PaperMaterial;

export function createPaperNodeMaterial(mask: THREE.Texture): PaperNodeMaterial {
  const material = new PaperMaterial({ side: THREE.DoubleSide, alphaTest: 0.5 });
  const crease = material.crease;

  // Where this point lies on the flat sheet, and how much sheet one pixel covers.
  const p = uv().mul(2).sub(1);
  const footprint = length(fwidth(p));
  const surface = paperSurface({ p, footprint, crease, facing: faceDirection });
  const height = surface.x;
  const formation = surface.y;
  const albedo = surface.z;
  const shade = surface.w;

  material.opacityNode = texture(mask, uv()).r;

  // Warm white, mottled by the pulp; creases hold a little shadow in their furrows.
  const paper = vec3(0.975, 0.97, 0.955);
  material.colorNode = paper.mul(albedo).mul(float(1).sub(shade.mul(0.07)));
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
  // the formation let more through, as when paper is held to a window.
  material.transmittanceNode = vec3(1.0, 0.95, 0.86).mul(mix(float(0.55), float(0.3), formation));

  return material;
}
