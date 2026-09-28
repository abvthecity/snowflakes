// Shared between the WebGPU and WebGL paper; see foldShading in paper.wgsl.

/** How much darker a flap is right at its folded edge, where it curls away. */
export const CURL_SHADE = 0.12;
/** How much darker the paper is right beside the edge of a flap lying on it. */
export const CONTACT_SHADE = 0.3;
