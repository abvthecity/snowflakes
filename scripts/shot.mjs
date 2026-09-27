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
  // Straight cuts: click three corners, then the first again to close.
  await page.getByRole("radio", { name: "Straight" }).click();
  for (const [x, y] of [[430, 300], [505, 330], [455, 372], [430, 300]]) await page.mouse.click(x, y);
  // A curve: a sharp corner, two dragged (smooth) points, then close with the Cut button.
  await page.getByRole("radio", { name: "Curve" }).click();
  await page.mouse.click(440, 430);
  for (const [x, y, dx] of [[480, 470, 30], [440, 520, -30]]) {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx, y + 10, { steps: 2 });
    await page.mouse.up();
  }
  await page.mouse.move(420, 480);
  await frames(page, 3);
  await page.screenshot({ path: new URL("9b-pen-tools.png", out).pathname });
  console.log("shots/9b-pen-tools.png");
  await page.getByRole("button", { name: "Cut", exact: true }).click();
  await page.getByRole("button", { name: "Surprise me" }).click();
  await page.getByRole("button", { name: "Unfold" }).click();
  await page.getByRole("button", { name: "Fold back up" }).waitFor({ timeout: 90_000 });
  await frames(page, 2);
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
  if (!saved?.events?.some((e) => e.k === "cut" && e.tool === "curve")) errors.push("save: the recording has no curve cut");
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
  await phoneShot("11-phone-start");
  for (let i = 0; i < 4; i++) await phone.getByRole("button", { name: "Fold", exact: true }).tap({ timeout: 90_000 });
  await phone.getByRole("button", { name: "Trim" }).tap({ timeout: 90_000 });
  // Freehand: a loop drawn with a finger.
  const loop = Array.from({ length: 13 }, (_, i) => [190 + 28 * Math.cos((i / 12) * 2 * Math.PI), 290 + 22 * Math.sin((i / 12) * 2 * Math.PI)]);
  await drag(loop);
  // Straight: tap three corners, then the first again.
  await phone.getByRole("radio", { name: "Straight" }).tap();
  for (const [x, y] of [[150, 380], [218, 398], [172, 440], [150, 380]]) await phone.touchscreen.tap(x, y);
  // Curve: a tapped corner, a dragged smooth point, another corner, then Cut.
  await phone.getByRole("radio", { name: "Curve" }).tap();
  await phone.touchscreen.tap(185, 470);
  await drag([[222, 492], [236, 500], [250, 508]]);
  await phone.touchscreen.tap(195, 525);
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
