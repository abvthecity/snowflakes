// Everything that needs three/webgpu, split out so WebGL-only browsers never load it.
import { WebGPURenderer } from "three/webgpu";

export { createPaperNodeMaterial, type PaperNodeMaterial } from "./paperNodeMaterial";

export async function createRenderer(canvas: HTMLCanvasElement, antialias: boolean) {
  const renderer = new WebGPURenderer({ canvas, antialias, alpha: true });
  await renderer.init();
  return renderer;
}
