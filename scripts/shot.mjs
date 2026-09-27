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
import { mkdir, writeFile } from "node:fs/promises";

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

/**
 * The panel must keep one size and place through every step, so the screen
 * never jumps, and its text must fit without scrolling. Records a problem
 * when the panel's box differs from the first one seen on this page.
 */
const steady = (page, label) => {
  let first = null;
  return async (step) => {
    await page.locator(".panel").waitFor();
    const box = await page.evaluate(() => {
      const p = document.querySelector(".panel");
      const b = p.querySelector(".body");
      const r = p.getBoundingClientRect();
      return { box: [r.x, r.y, r.width, r.height].map(Math.round).join(","), overflow: b.scrollHeight > b.clientHeight + 1 };
    });
    first ??= box.box;
    if (box.box !== first) errors.push(`${label}: panel moved at ${step} (${box.box}, was ${first})`);
    if (box.overflow) errors.push(`${label}: panel text overflows at ${step}`);
  };
};

const stills = [
  ["1-flat", "?fold=0"],
  ["2-first-fold", "?fold=0.55"],
  ["2b-thirds", "?fold=2.5"],
  ["3-folded", "?fold=4"],
  ["4-folded-and-cut", "?demo=11&fold=4"],
  ["5-unfolding", "?demo=11&fold=1.4"],
  ["6-snowflake", "?demo=11&fold=0"],
  ["7-another", "?demo=5&fold=0"],
  // Coloured papers, lit from the front and glowing where light comes through.
  ["7d-mint", "?demo=11&fold=0&paper=mint"],
  ["7e-blush-folded", "?demo=11&fold=4&paper=blush"],
  // The WebGL fallback, for browsers without WebGPU.
  ["7c-webgl", "?demo=11&fold=0&webgl"],
  ["7f-webgl-lilac", "?demo=11&fold=0&webgl&paper=lilac"],
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
  const check = steady(page, "desktop");
  // Pick the paper first; the colours are only offered before the first fold.
  await page.getByRole("radio", { name: "Butter" }).click({ timeout: 90_000 });
  await frames(page, 3);
  await page.screenshot({ path: new URL("7a-paper-colours.png", out).pathname });
  console.log("shots/7a-paper-colours.png");
  // One press per fold; each waits for the last fold to finish.
  for (let i = 1; i <= 4; i++) {
    await check(`fold ${i}`);
    await page.getByRole("button", { name: "Fold", exact: true }).click({ timeout: 90_000 });
    await check(`folding ${i}`);
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
  await check("trim");
  await page.getByRole("button", { name: "Trim" }).click();
  await frames(page, 3);
  await check("cut");
  await page.screenshot({ path: new URL("9-trimmed.png", out).pathname });
  console.log("shots/9-trimmed.png");
  // One pair of scissors. Clicks drop corners: with two down, the piece they
  // would cut away (closed through the pointer) fades.
  await page.mouse.click(205, 300);
  await page.mouse.click(280, 330);
  await page.mouse.move(230, 372, { steps: 2 });
  await frames(page, 3);
  await page.screenshot({ path: new URL("9a-cut-preview.png", out).pathname });
  console.log("shots/9a-cut-preview.png");
  // Click the last corner, then the first again to cut.
  for (const [x, y] of [[230, 372], [205, 300]]) await page.mouse.click(x, y);
  // A drag draws freehand, fading what it encloses as it goes; ending back on its start cuts it.
  const ring = (cx, cy, rx, ry, n = 24) =>
    Array.from({ length: n + 1 }, (_, i) => [cx + rx * Math.sin((i / n) * 2 * Math.PI), cy - ry * Math.cos((i / n) * 2 * Math.PI)]);
  const lasso = ring(225, 470, 26, 36);
  await page.mouse.move(...lasso[0]);
  await page.mouse.down();
  for (const [x, y] of lasso.slice(1, 17)) await page.mouse.move(x, y);
  await frames(page, 3);
  await page.screenshot({ path: new URL("9b-drawing.png", out).pathname });
  console.log("shots/9b-drawing.png");
  await check("drawing");
  for (const [x, y] of lasso.slice(17)) await page.mouse.move(x, y);
  await page.mouse.up();
  await page.mouse.move(600, 560);
  await frames(page, 3);
  // The loop is cut and smoothed into a few curves, with points and handles to reshape it.
  await page.screenshot({ path: new URL("9c-smoothed.png", out).pathname });
  console.log("shots/9c-smoothed.png");
  // Mixed: a corner, then a drag that carries on from it, then close with the Cut button.
  await page.mouse.click(175, 380);
  await page.mouse.move(195, 395);
  await page.mouse.down();
  for (const [x, y] of [[205, 410], [203, 425], [193, 436], [180, 440]]) await page.mouse.move(x, y);
  await page.mouse.up();
  await page.getByRole("button", { name: "Cut", exact: true }).click();
  // A band right across the top severs the tip: it fades with the band before
  // the cut, and falls away with it after.
  for (const [x, y] of [[105, 243], [335, 285], [335, 302]]) await page.mouse.click(x, y);
  await page.mouse.move(105, 262, { steps: 2 });
  await frames(page, 3);
  await page.screenshot({ path: new URL("9d-severed-preview.png", out).pathname });
  console.log("shots/9d-severed-preview.png");
  for (const [x, y] of [[105, 262], [105, 243]]) await page.mouse.click(x, y);
  await page.mouse.move(700, 560);
  await frames(page, 3);
  await page.screenshot({ path: new URL("9e-severed.png", out).pathname });
  console.log("shots/9e-severed.png");
  // Reshape that last cut: drag one of its corners down a little (a "recut" in the recording).
  await page.mouse.move(560, 302);
  await page.mouse.down();
  await page.mouse.move(556, 312, { steps: 2 });
  await page.mouse.move(552, 322, { steps: 2 });
  await page.mouse.up();
  await page.getByRole("button", { name: "Surprise me" }).click();
  await page.getByRole("button", { name: "Unfold" }).click();
  await check("unfolding");
  await page.getByRole("button", { name: "Fold back up" }).waitFor({ timeout: 90_000 });
  await frames(page, 2);
  await check("open");
  await page.screenshot({ path: new URL("10-clicked-through.png", out).pathname });
  console.log("shots/10-clicked-through.png");

  // Save it, open the link, and replay how it was made. vite preview has no
  // Pages Functions, so the API is stood in for here; it keeps what was
  // posted and serves it back, so the recording makes the round trip.
  let saved = null;
  await page.route("**/api/snowflakes", async (route) => {
    saved = route.request().postDataJSON();
    await route.fulfill({ status: 201, json: { id: "shot1" } });
  });
  await page.getByRole("button", { name: "Save" }).click();
  const link = await page.getByRole("textbox", { name: "Link to this snowflake" }).inputValue({ timeout: 30_000 });
  if (!link.endsWith("?s=shot1")) errors.push(`save: link is ${link}`);
  await writeFile(new URL("recording.json", out), JSON.stringify(saved));
  const kinds = new Set(saved?.events?.map((e) => e.k));
  for (const k of ["fold", "trim", "cut", "recut", "unfold"]) if (!kinds.has(k)) errors.push(`save: the recording has no ${k}`);
  if (!saved?.events?.some((e) => e.k === "cut" && e.tool === "pen" && e.pts.some((v, i) => i % 5 === 2 && v !== 0)))
    errors.push("save: the recording has no curved pen cut");
  await page.close();

  const shared = await open("?s=shot1&lite", { width: 900, height: 640 });
  await shared.route("**/api/snowflakes/shot1", (route) => route.fulfill({ json: { id: "shot1", createdAt: 0, recording: saved } }));
  await shared.getByRole("button", { name: "Replay" }).click({ timeout: 90_000 });
  await shared.getByRole("heading", { name: "Replaying…" }).waitFor();
  // Let it reach the cutting, then catch a cut being drawn again.
  await shared.getByRole("button", { name: "Skip to the end" }).waitFor();
  await shared.locator(".app[data-stage=cutting]").waitFor({ timeout: 180_000 });
  await frames(shared, 4);
  await shared.screenshot({ path: new URL("10b-replaying.png", out).pathname });
  console.log("shots/10b-replaying.png");
  await shared.getByRole("button", { name: "Skip to the end" }).click();
  await shared.getByRole("button", { name: "Fold back up" }).waitFor({ timeout: 180_000 });
  await frames(shared, 2);
  await shared.screenshot({ path: new URL("10c-replayed.png", out).pathname });
  console.log("shots/10c-replayed.png");
  await shared.close();

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
  const phoneCheck = steady(phone, "phone");
  await phone.locator("html[data-ready]").waitFor({ timeout: 120_000 });
  await phone.getByRole("radio", { name: "Sky" }).tap();
  await phoneShot("11-phone-start");
  for (let i = 1; i <= 4; i++) {
    await phoneCheck(`fold ${i}`);
    await phone.getByRole("button", { name: "Fold", exact: true }).tap({ timeout: 90_000 });
    await phoneCheck(`folding ${i}`);
  }
  await phone.getByRole("button", { name: "Trim" }).waitFor({ timeout: 90_000 });
  await phoneCheck("trim");
  await phone.getByRole("button", { name: "Trim" }).tap();
  await phoneCheck("cut");
  // A loop drawn with a finger, back to where it started, cuts.
  const loop = Array.from({ length: 25 }, (_, i) => [190 + 28 * Math.sin((i / 24) * 2 * Math.PI), 290 - 22 * Math.cos((i / 24) * 2 * Math.PI)]);
  await drag(loop);
  // Three tapped corners: the piece they enclose fades before the shape is closed.
  for (const [x, y] of [[150, 380], [218, 398], [172, 440]]) await phone.touchscreen.tap(x, y);
  await phoneShot("12-phone-cutting");
  await phoneCheck("drawing");
  await phone.getByRole("button", { name: "Cut", exact: true }).tap();
  await phone.getByRole("button", { name: "Unfold" }).tap();
  await phoneCheck("unfolding");
  await phone.getByRole("button", { name: "Fold back up" }).waitFor({ timeout: 90_000 });
  await phoneCheck("open");
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
