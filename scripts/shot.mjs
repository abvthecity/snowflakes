// Screenshot the app: `pnpm build && pnpm shot`. Writes PNGs to shots/.
//
// Serves dist/ with `vite preview` and opens it in headless Chromium, which
// renders WebGL in software (SwiftShader), so it needs no GPU and runs in CI
// or the Docker runner. Software rendering manages about a frame a second,
// so the stills are set up from the URL (?demo, &fold) rather than by
// clicking through the animation; one pass does click through, to check the
// buttons drive the whole flow.
import { chromium } from "playwright";
import { preview } from "vite";
import { mkdir } from "node:fs/promises";

const out = new URL("../shots/", import.meta.url);
await mkdir(out, { recursive: true });

const port = 4317;
const server = await preview({ preview: { port, strictPort: true } });
const base = `http://localhost:${port}/`;
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const errors = [];

async function open(query, viewport = { width: 1280, height: 860 }) {
  const page = await browser.newPage({ viewport });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(base + query);
  return page;
}

/** Wait until the page has drawn `n` more frames. */
const frames = (page, n) =>
  page.evaluate(
    (n) => new Promise((done) => { let i = 0; const f = () => (++i >= n ? done() : requestAnimationFrame(f)); requestAnimationFrame(f); }),
    n,
  );

const stills = [
  ["1-flat", "?fold=0"],
  ["2-first-fold", "?fold=0.55"],
  ["3-folding", "?fold=2.6"],
  ["4-folded-and-cut", "?demo=11&fold=4"],
  ["5-unfolding", "?demo=11&fold=1.4"],
  ["6-snowflake", "?demo=11&fold=0"],
  ["7-another", "?demo=5&fold=0"],
];

try {
  for (const [name, query] of stills) {
    const page = await open(query);
    await page.locator("canvas").waitFor();
    await frames(page, 4);
    await page.screenshot({ path: new URL(`${name}.png`, out).pathname });
    console.log(`shots/${name}.png`);
    await page.close();
  }

  // Click through the real flow: fold, cut, unfold.
  const page = await open("?lite", { width: 900, height: 640 });
  await page.getByRole("button", { name: "Fold" }).click();
  await page.getByRole("button", { name: "Surprise me" }).click({ timeout: 90_000 });
  await page.getByRole("button", { name: "Unfold" }).click();
  await page.getByRole("button", { name: "Fold back up" }).waitFor({ timeout: 90_000 });
  await frames(page, 2);
  await page.screenshot({ path: new URL("8-clicked-through.png", out).pathname });
  console.log("shots/8-clicked-through.png");
} finally {
  await browser.close();
  await server.close();
}
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
