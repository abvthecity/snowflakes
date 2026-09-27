# Snowflakes

A 3D paper snowflake app: fold a square of paper corner to corner, in half, then in thirds, trim the top, cut a shape, and unfold a six-pointed snowflake. Built with react three fiber and realistic shaders.

## Run it

```sh
pnpm install
pnpm dev          # http://localhost:5173
```

1. **Fold, four times.** Each press of *Fold* makes one fold: corner to corner into a triangle, in half, then each side across by a third like a cone. That leaves twelve layers in a 30° wedge.
2. **Trim.** Slice straight across the top of the wedge along the dashed line, so the paper opens into a hexagon rather than a square.
3. **Cut.** Pick the scissors: *Freehand* cuts out a loop you draw; *Straight* cuts along corners you click one after another; *Curve* works like a drawing app's pen tool, where a click makes a corner and a press and drag pulls a smooth curve. Click the first point again (or press *Cut* or Enter) to close a straight or curved shape; Escape drops it and Backspace removes the last point. Every cut goes through all twelve layers. *Surprise me* adds a sample pattern; *Undo* takes the last cut back.
4. **Unfold.** The layers open one fold at a time into the snowflake. Drag to turn it, or fold it back up and keep cutting.

The URL can set a scene up directly: `?demo=<seed>` cuts a sample pattern and unfolds it, `&fold=<0–4>` holds the paper part-way folded, `&lite` skips shadows and antialiasing for slow GPUs, and `&webgl` draws with WebGL even where WebGPU is available.

## How it works

- `src/folds.ts` is the geometry. Every fold line passes through the centre, so the square splits into 12 sectors of 30°. Mirror images of one 30° wedge give six-fold symmetry, like a real snowflake. For each sector it works out which folds move it, where it lands once folded (a product of reflections), and its place in the stack.
- `src/cuts.ts` keeps the cut-out mask, a canvas over the flat square. A shape drawn on the folded wedge is carried back into each of the 12 sectors through that sector's reflections, so one cut appears twelve times, mirrored, when the paper opens.
- `src/Paper.tsx` draws the sectors and turns them about the fold lines as the fold amount runs from 0 to 4. Once opened, the creases ride alternately up and down so the sheet never lies quite flat, like real paper.
- `src/CuttingBoard.tsx` turns the pointer into cut outlines, and `src/penPath.ts` samples the pen tools' Bézier paths into them.
- `src/paper.wgsl` is the paper's surface, written in WGSL: short bent fibres at two scales, the cloudy formation of the pulp, and the crease lines, with mountains and valleys alternating round the sheet as the folds left them. It is a function of where a point lies on the flat sheet, so the texture stays put however the paper is folded, and it fades detail finer than a pixel instead of letting it shimmer.
- `src/paperNodeMaterial.ts` calls it from a three.js node material through [vgpu](https://vgpu.sh)'s `tslExports()` (the `.wgsl` import is resolved by vgpu's Vite plugin, which also pulls in `@vgpu/wgsl-std` noise). The material bumps the surface in world units, so fibres and creases keep their height at any zoom, and scatters light from behind through the sheet, patchy where the formation is thin, as when paper is held to a window.
- The app draws with `WebGPURenderer` where the browser has WebGPU (`src/gpu.ts` decides, and `src/webgpu.ts` is only loaded then). Elsewhere, or with `?webgl` in the URL, it draws with `WebGLRenderer` and `src/paperMaterial.ts`, the earlier GLSL paper: `MeshPhysicalMaterial` with a canvas fibre texture and a shader patch for light through the sheet. Everything else in the scene runs on either renderer, which is why the guide lines (`src/Stroke.tsx`) and the snow are plain meshes.

## Checks

```sh
pnpm test         # the fold geometry
pnpm build
pnpm shot         # screenshots of each stage into shots/, in headless Chromium
```

CI (`.github/workflows/check.yml`) runs all three and keeps the screenshots on the run. It runs on GitHub's runners, or on self-hosted Docker runners on the owner's machine: `scripts/runner/runner.sh up`, then `runner.sh local` to send CI there (`runner.sh hosted` sends it back). The runner setup is the same as abvthecity/linklater's.

## Deploys

`.github/workflows/deploy.yml` builds the app and ships it to the Cloudflare Pages project `snowflakes`. Every pull request gets a preview deployment and a comment with its URL; every merge to main is the production deployment. It needs the repo secrets `CLOUDFLARE_API_TOKEN` (with Cloudflare Pages: Edit) and `CLOUDFLARE_ACCOUNT_ID`, and creates the Pages project on its first run.
