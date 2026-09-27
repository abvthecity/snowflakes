// Screenshot the app: `pnpm build && pnpm shot`. Writes PNGs to shots/.
//
// Serves dist/ with `vite preview` and opens it in headless Chromium, which
// renders WebGPU (and WebGL, for the ?webgl fallback) in software through
// SwiftShader, so it needs no GPU and runs in CI
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
  // SwiftShader backs WebGL and, through Vulkan, WebGPU too, so both renderers can be checked.
  args: [
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--ignore-gpu-blocklist",
    "--enable-unsafe-webgpu",
    "--enable-features=Vulkan",
    "--use-vulkan=swiftshader",
    "--use-webgpu-adapter=swiftshader",
  ],
});
const errors = [];

/**
 * This Chromium's experimental WebGPU (behind --enable-unsafe-webgpu) rejects
 * the texture view `swizzle` that three sets to the identity "rgba"; released
 * browsers ignore it. Drop it, so the WebGPU renderer runs here too.
 */
const dropIdentitySwizzle = () => {
  if (!self.GPUTexture) return;
  const createView = GPUTexture.prototype.createView;
  GPUTexture.prototype.createView = function (d) {
    if (d?.swizzle === "rgba") {
      d = { ...d };
      delete d.swizzle;
    }
    return createView.call(this, d);
  };
};

async function open(query, viewport = { width: 1280, height: 860 }) {
  const page = await browser.newPage({ viewport });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.addInitScript(dropIdentitySwizzle);
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
  ["2b-thirds", "?fold=2.5"],
  ["3-folded", "?fold=4"],
  ["4-folded-and-cut", "?demo=11&fold=4"],
  ["5-unfolding", "?demo=11&fold=1.4"],
  ["6-snowflake", "?demo=11&fold=0"],
  ["7-another", "?demo=5&fold=0"],
  // The other way to fold: in half, into 60° thirds, then in half into a cone.
  ["h1-half-flat", "?method=half&fold=0"],
  ["h2-half-first-fold", "?method=half&fold=0.5"],
  ["h3-half-folded-once", "?method=half&fold=1"],
  ["h4-half-thirds", "?method=half&fold=2.5"],
  ["h5-half-point", "?method=half&fold=3"],
  ["h6-half-cone", "?method=half&fold=3.5"],
  ["h7-half-folded", "?method=half&fold=4"],
  ["h8-half-cut", "?method=half&demo=11&fold=4"],
  ["h9-half-snowflake", "?method=half&demo=11&fold=0"],
  // The WebGL fallback, for browsers without WebGPU.
  ["7c-webgl", "?demo=11&fold=0&webgl"],
];

try {
  for (const [name, query] of stills) {
    const page = await open(query);
    // Wait for the renderer to finish compiling its materials (WebGPU does so in the background).
    await page.locator("html[data-ready]").waitFor({ timeout: 120_000 });
    // Only ?webgl should fall back; anything else means WebGPU went unchecked.
    const renderer = await page.evaluate(() => document.documentElement.dataset.renderer);
    if (renderer !== (query.includes("webgl") ? "webgl" : "webgpu")) errors.push(`${name}: drew with ${renderer}`);
    await frames(page, 4);
    await page.screenshot({ path: new URL(`${name}.png`, out).pathname });
    console.log(`shots/${name}.png`);
    await page.close();
  }

  // Click through the real flow: fold, trim, cut, unfold.
  const page = await open("?lite", { width: 900, height: 640 });
  // One press per fold; each waits for the last fold to finish.
  for (let i = 1; i <= 4; i++) {
    await page.getByRole("button", { name: "Fold", exact: true }).click({ timeout: 90_000 });
    if (i === 2) {
      await page.getByText("Step 3 of 7").waitFor({ timeout: 90_000 });
      await frames(page, 3);
      await page.screenshot({ path: new URL("7b-step-3.png", out).pathname });
      console.log("shots/7b-step-3.png");
    }
  }
  await page.getByRole("button", { name: "Trim" }).waitFor({ timeout: 90_000 });
  await frames(page, 3);
  await page.screenshot({ path: new URL("8-trim-guide.png", out).pathname });
  console.log("shots/8-trim-guide.png");
  await page.getByRole("button", { name: "Trim" }).click();
  await frames(page, 3);
  await page.screenshot({ path: new URL("9-trimmed.png", out).pathname });
  console.log("shots/9-trimmed.png");
  // One pair of scissors. Clicks drop corners: with two down, the piece they
  // would cut away (closed through the pointer) fades.
  await page.mouse.click(430, 300);
  await page.mouse.click(505, 330);
  await page.mouse.move(455, 372, { steps: 2 });
  await frames(page, 3);
  await page.screenshot({ path: new URL("9a-cut-preview.png", out).pathname });
  console.log("shots/9a-cut-preview.png");
  // Click the last corner, then the first again to cut.
  for (const [x, y] of [[455, 372], [430, 300]]) await page.mouse.click(x, y);
  // A drag draws freehand, fading what it encloses as it goes; ending back on its start cuts it.
  const ring = (cx, cy, rx, ry, n = 24) =>
    Array.from({ length: n + 1 }, (_, i) => [cx + rx * Math.sin((i / n) * 2 * Math.PI), cy - ry * Math.cos((i / n) * 2 * Math.PI)]);
  const lasso = ring(450, 470, 26, 36);
  await page.mouse.move(...lasso[0]);
  await page.mouse.down();
  for (const [x, y] of lasso.slice(1, 17)) await page.mouse.move(x, y);
  await frames(page, 3);
  await page.screenshot({ path: new URL("9b-drawing.png", out).pathname });
  console.log("shots/9b-drawing.png");
  for (const [x, y] of lasso.slice(17)) await page.mouse.move(x, y);
  await page.mouse.up();
  await page.mouse.move(600, 560);
  await frames(page, 3);
  // The loop is cut and smoothed into a few curves, with points and handles to reshape it.
  await page.screenshot({ path: new URL("9c-smoothed.png", out).pathname });
  console.log("shots/9c-smoothed.png");
  // Mixed: a corner, then a drag that carries on from it, then close with the Cut button.
  await page.mouse.click(400, 380);
  await page.mouse.move(420, 395);
  await page.mouse.down();
  for (const [x, y] of [[430, 410], [428, 425], [418, 436], [405, 440]]) await page.mouse.move(x, y);
  await page.mouse.up();
  await page.getByRole("button", { name: "Cut", exact: true }).click();
  // A band right across the top severs the tip: it fades with the band before
  // the cut, and falls away with it after.
  for (const [x, y] of [[330, 243], [560, 285], [560, 302]]) await page.mouse.click(x, y);
  await page.mouse.move(330, 262, { steps: 2 });
  await frames(page, 3);
  await page.screenshot({ path: new URL("9d-severed-preview.png", out).pathname });
  console.log("shots/9d-severed-preview.png");
  for (const [x, y] of [[330, 262], [330, 243]]) await page.mouse.click(x, y);
  await page.mouse.move(700, 560);
  await frames(page, 3);
  await page.screenshot({ path: new URL("9e-severed.png", out).pathname });
  console.log("shots/9e-severed.png");
  await page.getByRole("button", { name: "Surprise me" }).click();
  await page.getByRole("button", { name: "Unfold" }).click();
  await page.getByRole("button", { name: "Fold back up" }).waitFor({ timeout: 90_000 });
  await frames(page, 2);
  await page.screenshot({ path: new URL("10-clicked-through.png", out).pathname });
  console.log("shots/10-clicked-through.png");

  // The same flow on a phone, by touch: taps for the buttons and corners,
  // finger drags for the freehand loop, a curve handle and turning the result.
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  phone.on("pageerror", (e) => errors.push(e.message));
  await phone.addInitScript(dropIdentitySwizzle);
  await phone.goto(base + "?lite");
  const touch = await phone.context().newCDPSession(phone);
  const drag = async (points) => {
    const [first, ...rest] = points;
    await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: first[0], y: first[1] }] });
    for (const [x, y] of rest) await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y }] });
    await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  };
  const phoneShot = async (name) => {
    await frames(phone, 3);
    await phone.screenshot({ path: new URL(`${name}.png`, out).pathname });
    console.log(`shots/${name}.png`);
  };
  // Fold this one the other way, in half first.
  await phone.getByRole("radio", { name: "In half first" }).tap();
  await phoneShot("11-phone-start");
  for (let i = 0; i < 4; i++) await phone.getByRole("button", { name: "Fold", exact: true }).tap({ timeout: 90_000 });
  await phone.getByRole("button", { name: "Trim" }).tap({ timeout: 90_000 });
  // A loop drawn with a finger, back to where it started, cuts.
  const loop = Array.from({ length: 25 }, (_, i) => [190 + 28 * Math.sin((i / 24) * 2 * Math.PI), 290 - 22 * Math.cos((i / 24) * 2 * Math.PI)]);
  await drag(loop);
  // Three tapped corners: the piece they enclose fades before the shape is closed.
  for (const [x, y] of [[150, 380], [218, 398], [172, 440]]) await phone.touchscreen.tap(x, y);
  await phoneShot("12-phone-cutting");
  await phone.getByRole("button", { name: "Cut", exact: true }).tap();
  await phone.getByRole("button", { name: "Unfold" }).tap();
  await phone.getByRole("button", { name: "Fold back up" }).waitFor({ timeout: 90_000 });
  // Turn the snowflake with a finger.
  await drag([[200, 400], [230, 390], [260, 380]]);
  await phoneShot("13-phone-snowflake");
} finally {
  await browser.close();
  await server.close();
}
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
