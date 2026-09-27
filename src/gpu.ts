// Which renderer to use. Where the browser has WebGPU, the scene draws with
// three's WebGPURenderer and the paper uses the WGSL material (webgpu.ts,
// loaded only then). Everywhere else, and with `?webgl` in the URL, it stays
// on WebGLRenderer and the GLSL paper in paperMaterial.ts.
export type WebGPUKit = typeof import("./webgpu");

let kit: WebGPUKit | null = null;

/** The WebGPU pieces, or null when drawing with WebGL. Settled before the app first renders. */
export const webgpu = () => kit;

export async function chooseRenderer(): Promise<void> {
  if (new URLSearchParams(location.search).has("webgl") || !("gpu" in navigator)) return;
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return;
    kit = await import("./webgpu");
  } catch (e) {
    console.warn("WebGPU unavailable, drawing with WebGL", e);
    kit = null;
  }
}
