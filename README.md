# Snowflakes

A 3D paper snowflake app: fold a square of paper diagonally four times, cut a shape, and unfold to reveal it. Built with react three fiber and realistic shaders.

## Run it

```sh
pnpm install
pnpm dev          # http://localhost:5173
```

1. **Fold.** The square folds along one diagonal, then the other, then in half twice more: sixteen layers in a thin wedge.
2. **Cut.** Draw a closed shape across the folded paper with the mouse or a finger. Wherever it overlaps the paper, it cuts through every layer. *Surprise me* adds a sample pattern; *Undo* takes the last cut back.
3. **Unfold.** The layers open one fold at a time into the snowflake. Drag to turn it, or fold it back up and keep cutting.

The URL can set a scene up directly: `?demo=<seed>` cuts a sample pattern and unfolds it, `&fold=<0–4>` holds the paper part-way folded, and `&lite` skips shadows and antialiasing for slow GPUs.

## How it works

- `src/folds.ts` is the geometry. Every fold line passes through the centre, so the square splits into 16 sectors of 22.5°. For each sector it works out which folds move it, where it lands once folded (a product of reflections), and its place in the stack.
- `src/cuts.ts` keeps the cut-out mask, a canvas over the flat square. A shape drawn on the folded wedge is carried back into each of the 16 sectors through that sector's reflections, so one cut appears sixteen times, mirrored, when the paper opens.
- `src/Paper.tsx` draws the sectors and turns them about the fold lines as the fold amount runs from 0 to 4. Once opened, the creases ride alternately up and down so the sheet never lies quite flat, like real paper.
- `src/paperMaterial.ts` is the paper: `MeshPhysicalMaterial` with a procedural fibre texture for colour, bump and roughness, sheen, and a shader patch that lets light behind the sheet glow through it.

## Checks

```sh
pnpm test         # the fold geometry
pnpm build
pnpm shot         # screenshots of each stage into shots/, in headless Chromium
```

CI (`.github/workflows/check.yml`) runs all three and keeps the screenshots on the run. It runs on GitHub's runners, or on self-hosted Docker runners on the owner's machine: `scripts/runner/runner.sh up`, then `runner.sh local` to send CI there (`runner.sh hosted` sends it back). The runner setup is the same as abvthecity/linklater's.

## Deploys

`.github/workflows/deploy.yml` builds the app and ships it to the Cloudflare Pages project `snowflakes`. Every pull request gets a preview deployment and a comment with its URL; every merge to main is the production deployment. It needs the repo secrets `CLOUDFLARE_API_TOKEN` (with Cloudflare Pages: Edit) and `CLOUDFLARE_ACCOUNT_ID`, and creates the Pages project on its first run.
