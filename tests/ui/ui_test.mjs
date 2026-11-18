// End-to-end test of the web app in Chromium, through the dev server, with a fake
// YouTube (embed player + channel pages), a fake WindowSwap and a fixed date.
//   node tests/ui/ui_test.mjs [screenshot-dir]
// Needs Node 20+ and the `playwright` package (npm install) with Chromium.
import { spawn } from "node:child_process";
import { readFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const shots = process.argv[2] || null;
if (shots) mkdirSync(shots, { recursive: true });

const PORT = 8797;
const base = `http://127.0.0.1:${PORT}`;
// 10:00 in Ithaca and Panama, 17:00 in Namibia (all light), 05:00 on Kauai (dark)
const NOW = new Date("2026-11-07T15:00:00Z");
const cams = [
  { id: "feeder", name: "Cornell FeederWatch", location: "Ithaca, New York", type: "youtube", source: "@Birds", match: "FeederWatch", tz: "America/New_York", lat: 42.48, lon: -76.45 },
  { id: "namib", name: "Namib Desert Waterhole", location: "Namibia", type: "youtube", source: "@NamibiaCam", match: "", tz: "Africa/Windhoek", lat: -24.6, lon: 15.8 },
  { id: "panama", name: "Panama Fruit Feeder", location: "El Valle de Antón, Panama", type: "youtube", source: "@Birds", match: "Panama", tz: "America/Panama", lat: 8.6, lon: -80.13 },
  { id: "kauai", name: "Kauai Coast", location: "Kauai, Hawaii", type: "youtube", source: "https://www.youtube.com/watch?v=KAUAI000001", match: "", tz: "Pacific/Honolulu", lat: 22.08, lon: -159.5 },
  { id: "windowswap", name: "WindowSwap", location: "A random window, anywhere", type: "windowswap", source: "", match: "", tz: "", lat: null, lon: null },
];
const seed = JSON.stringify({ version: 3, favorite: "feeder", cams, resolved: {}, prefs: {}, keys: {} });
const watch = (id) => `https://www.youtube.com/watch?v=${id}`;

// fake YouTube channel pages, served through the app's /proxy
const streams = (videos) => `<html><script>var ytInitialData = ${JSON.stringify({ contents: { items: videos.map(([id, title]) => ({
  richItemRenderer: { content: { videoRenderer: { videoId: id, title: { runs: [{ text: title }] },
    thumbnailOverlays: [{ thumbnailOverlayTimeStatusRenderer: { style: "LIVE" } }] } } } })) } })};</script></html>`;
const PAGES = {
  "https://www.youtube.com/@Birds/streams": streams([["PANAMA00001", "Panama Fruit Feeder Cam"], ["FEEDER00001", "Cornell Lab FeederWatch Cam"]]),
  "https://www.youtube.com/@NamibiaCam/live": '<link rel="canonical" href="https://www.youtube.com/watch?v=NAMIB000001"> "isLiveNow":true',
};

const server = spawn("node", [join(root, "tools", "devserver.mjs"), "--port", String(PORT)], { stdio: ["ignore", "pipe", "pipe"] });
let log = "";
server.stdout.on("data", (d) => (log += d));
server.stderr.on("data", (d) => (log += d));

let failures = 0;
function check(cond, label) {
  console.log((cond ? "  ok   " : "  FAIL ") + label);
  if (!cond) failures++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 10000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      if (await fn()) return true;
    } catch (e) { /* retry */ }
    await sleep(150);
  }
  return false;
}

const mock = readFileSync(join(here, "mock-youtube.js"), "utf8");
const svg = (c) => `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360"><rect width="480" height="360" fill="#000"/><rect y="45" width="480" height="270" fill="${c}"/></svg>`;

/** A TV page with the fakes in place, the seeded cams and the fixed date. */
async function openTv(ctx, path, counters) {
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { console.log("  page error:", e.message); failures++; });
  await page.clock.install({ time: NOW });
  await page.clock.resume();
  await page.route("https://www.youtube.com/iframe_api", (r) => r.fulfill({ contentType: "text/javascript", body: mock }));
  // the network check before opening a cam (counters.offline: YouTube can't be reached)
  await page.route("https://www.youtube.com/generate_204**", (r) => {
    counters.netChecks = (counters.netChecks || 0) + 1;
    if (counters.offline) r.abort("internetdisconnected");
    else r.fulfill({ status: 204, body: "" });
  });
  const colors = ["#6d8fb3", "#d9a066", "#4f7f5a", "#8a6db3"];
  let n = 0;
  await page.route("https://i.ytimg.com/**", (r) => r.fulfill({ contentType: "image/svg+xml", body: svg(colors[n++ % colors.length]) }));
  await page.route("https://www.window-swap.com/**", (r) => {
    counters.swap++;
    r.fulfill({ contentType: "text/html", body: "<body style='margin:0;background:linear-gradient(#9cc,#cba)'><h1 style='font:40px sans-serif;padding:40px'>a window</h1></body>" });
  });
  await page.route("**/proxy?**", (r) => {
    counters.proxied++;
    const target = new URL(r.request().url()).searchParams.get("url");
    if (PAGES[target]) r.fulfill({ contentType: "text/html", body: PAGES[target] });
    else r.fulfill({ status: 502, body: "offline" });
  });
  await page.goto(base + path);
  await page.waitForFunction(() => window.LampLauncher);
  return page;
}

async function seeded(browser, viewport, deviceScaleFactor = 1) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor });
  await ctx.addInitScript((state) => {
    if (location.pathname === "/" && !localStorage.getItem("lamplauncher-seeded")) {
      localStorage.setItem("lamplauncher-state", state);
      localStorage.setItem("lamplauncher-seeded", "1");
    }
  }, seed);
  return ctx;
}

// PW_CHANNEL=chrome uses an installed Google Chrome instead of Playwright's Chromium
const browser = await chromium.launch({
  channel: process.env.PW_CHANNEL || undefined,
  args: ["--autoplay-policy=no-user-gesture-required", "--enable-unsafe-swiftshader"],
});
try {
  await until(async () => (await fetch(base + "/admin")).ok, 15000);
  const counters = { swap: 0, proxied: 0 };
  const ctx = await seeded(browser, { width: 1920, height: 1080 });
  const page = await openTv(ctx, "/?wake=1", counters);

  const snap = () => page.evaluate(() => window.LampLauncher.controller.snapshot());
  const dev = () => page.evaluate(() => JSON.parse(JSON.stringify(window.LampLauncherDev.state)));
  const key = async (k) => { await page.keyboard.press(k); await sleep(250); };
  const longOk = async () => {
    await page.keyboard.down("Enter");
    await sleep(750);
    await page.keyboard.up("Enter");
    await sleep(250);
  };
  const globe = (expr) => page.evaluate(`(() => { const g = window.LampLauncher.view.globe; return ${expr}; })()`);
  const settled = () => until(async () => !(await globe("g.spinning")), 5000);
  const mockPlayer = () => page.evaluate(() => {
    const p = (window.__mockPlayers || []).at(-1);
    return p ? { id: p.opts.videoId, muted: p.muted, destroyed: Boolean(p.destroyed), ref: p.referrerPolicy, src: p.embedSrc } : null;
  });
  const home = async () => {
    await page.clock.fastForward(20000); // past waking up
    await key("h");
    await sleep(300);
  };

  console.log("switching on -> the default cam opens in the YouTube app (found through its channel page)");
  check(await until(async () => (await dev()).youtube.length === 1), "YouTube app opened once");
  check((await dev()).youtube[0] === watch("FEEDER00001"), "with today's stream from the channel page");
  check(counters.proxied > 0, "channel page fetched through /proxy");
  check(!(await snap()).active, "LampLauncher is behind the YouTube app");
  if (shots) await page.screenshot({ path: join(shots, "0-youtube-app.png") });

  console.log("Home -> the globe, nothing re-opens");
  await home();
  let s = await snap();
  check(s.active && s.view === "globe", "globe shown");
  check(s.selected === "feeder", "on the default cam, where it's daylight");
  check((await dev()).youtube.length === 1, "not thrown back into YouTube");

  console.log("the globe");
  check(await until(() => globe("g.loaded"), 10000), "Earth pictures loaded");
  const kind = await page.evaluate(() => document.body.dataset.globe);
  console.log(`       (drawn with ${kind})`);
  check(kind === "webgl" || kind === "cpu", "a renderer is running");
  await settled();
  const centre = await globe("g.pixel(0.5, 0.5)");
  check(centre[3] === 255 && centre[0] + centre[1] + centre[2] > 40, `the Earth fills the middle (${centre})`);
  const corner = await globe("g.pixel(0.01, 0.01)");
  check(corner[3] < 40, `space round it (${corner})`);
  const light = await page.evaluate(async () => {
    const geo = await import("/js/core/geo.js");
    const sun = await import("/js/core/sun.js");
    const { GLOBE_SCALE } = await import("/js/ui/globe.js");
    const g = window.LampLauncher.view.globe;
    const m = geo.viewMatrix(g.view);
    const now = new Date();
    let dayPx = null;
    let nightPx = null;
    for (let lat = -60; lat <= 60 && !(dayPx && nightPx); lat += 5) {
      for (let lon = -180; lon < 180; lon += 5) {
        const p = geo.project(m, lat, lon);
        if (p.z < 0.5) continue;
        const e = sun.sunElevation(lat, lon, now);
        const at = [0.5 + (p.x * GLOBE_SCALE) / 2, 0.5 - (p.y * GLOBE_SCALE) / 2];
        if (!dayPx && e > 35) dayPx = g.pixel(...at);
        if (!nightPx && e < -15) nightPx = g.pixel(...at);
      }
    }
    return { dayPx, nightPx };
  });
  const edges = await page.evaluate(async () => {
    const { GLOBE_SCALE } = await import("/js/ui/globe.js");
    const g = window.LampLauncher.view.globe;
    const out = [];
    for (const [fx, fy] of [[0.001, 0.5], [0.999, 0.5], [0.5, 0.001], [0.5, 0.999]]) out.push(g.pixel(fx, fy)[3]);
    // just outside the Earth's edge, left and right
    const glow = [0.5 - (1.03 * GLOBE_SCALE) / 2, 0.5 + (1.03 * GLOBE_SCALE) / 2].map((fx) => g.pixel(fx, 0.5)[3]);
    return { out, glow };
  });
  check(edges.out.every((a) => a === 0), `the glow fades out before the canvas's edges, no cut-off lines (${edges.out})`);
  check(edges.glow.every((a) => a > 5), `but there is a glow round the Earth (${edges.glow})`);
  const lum = (p) => p[0] * 0.3 + p[1] * 0.59 + p[2] * 0.11;
  check(light.dayPx && light.nightPx && lum(light.dayPx) > 2 * lum(light.nightPx),
    `the night side is darker (day ${light.dayPx}, night ${light.nightPx})`);

  console.log("dots, the default's star, and the preview");
  check(await page.locator(".marker.place").count() === 4 && await page.locator(".marker.satellite").count() === 1,
    "a dot per cam on the globe, WindowSwap in orbit");
  check(await page.locator('.marker.favorite[data-id="feeder"] .dot svg').count() === 1, "the default cam is a star");
  check(await page.locator(".marker.place:not(.favorite) .dot svg").count() === 0, "the others are dots");
  const pos = await page.evaluate(() => {
    const m = window.LampLauncher.view.markers().feeder;
    const r = document.getElementById("globe").getBoundingClientRect();
    return { dx: m.x - (r.left + r.width / 2), dy: m.y - (r.top + r.height / 2) };
  });
  check(Math.abs(pos.dx) < 4 && pos.dy < 0 && pos.dy > -300, `the selected cam is in the middle, a little north (${pos.dx.toFixed(1)}, ${pos.dy.toFixed(1)})`);
  check(await page.locator(".marker.selected").getAttribute("data-id") === "feeder", "and highlighted");
  check(await page.locator("#preview-name").textContent() === "Cornell FeederWatch", "preview names it");
  check((await page.locator("#preview-where").textContent()).startsWith("Ithaca, New York · 10:0"), "with its place and local time");
  check((await page.locator("#preview-sun").textContent()) === "☀ Daylight", "and the light there");
  check(await until(async () => (await page.locator("#preview-live.on").count()) === 1, 6000), "live preview plays");
  let mp = await mockPlayer();
  check(mp && mp.id === "FEEDER00001" && mp.muted, "muted, the right stream");
  check(mp && mp.ref === "strict-origin-when-cross-origin" && mp.src.includes("origin=http%3A%2F%2F127.0.0.1"), "embed sends a referrer (avoids YouTube error 153)");
  if (shots) await page.screenshot({ path: join(shots, "1-globe.png") });

  console.log("▶ spins to the next cam east");
  await page.keyboard.press("ArrowRight");
  await sleep(150);
  check(await globe("g.spinning"), "spinning");
  if (shots) await page.screenshot({ path: join(shots, "2-spinning.png") });
  await settled();
  check(Math.abs((await globe("g.view.lon")) - 15.8) < 0.01, "turned to Namibia");
  s = await snap();
  check(s.selected === "namib", "Namib selected");
  check(await page.locator("#preview-name").textContent() === "Namib Desert Waterhole", "preview follows");
  check(await page.evaluate(() => window.__mockPlayers.filter((p) => p.opts.videoId === "FEEDER00001").every((p) => p.destroyed)),
    "previous preview stopped");
  check(await until(async () => ((await mockPlayer()) || {}).id === "NAMIB000001" && (await page.locator("#preview-live.on").count()) === 1, 6000),
    "new preview plays");

  console.log("hold OK -> the default (★) moves");
  await longOk();
  check((await snap()).cams.find((c) => c.id === "namib").favorite, "Namib is the default");
  check(await page.locator('.marker.favorite[data-id="namib"] .dot svg').count() === 1, "and has the star");
  check(await page.locator('.marker[data-id="feeder"].favorite').count() === 0, "the old default is a dot again");
  check((await page.locator("#toast").textContent()).includes("now opens when you turn on the TV"), "says so");
  check(await page.locator("#preview-star").isVisible(), "preview shows ★ Default");

  console.log("OK -> the YouTube app; Home -> back on the same cam");
  await key("Enter");
  check(await until(async () => (await dev()).youtube.length === 2), "YouTube app opened");
  check((await dev()).youtube[1] === watch("NAMIB000001"), "with Namib's stream");
  check(await until(async () => (await page.locator("#preview-live iframe").count()) === 0, 3000), "preview stops behind it");
  await home();
  s = await snap();
  check(s.active && s.view === "globe" && s.selected === "namib", "back on Namib");
  check((await dev()).youtube.length === 2, "nothing re-opened");

  console.log("▲ -> WindowSwap (in orbit beside the globe)");
  check(await page.locator("#hint-up").isVisible() && (await page.locator("#hint-up").textContent()).includes("WindowSwap"), "a ▲ WindowSwap tip");
  await key("ArrowUp");
  check((await snap()).selected === "windowswap", "▲ moves the cursor up to it");
  check((await snap()).view === "globe" && (await dev()).youtube.length === 2, "without opening it");
  check(await page.locator('.marker.satellite.selected[data-id="windowswap"]').count() === 1, "highlighted");
  check((await page.locator("#hint-down").textContent()).includes("back to the globe") && await page.locator("#hint-up").isHidden(),
    "tips: ▼ back to the globe");
  await key("ArrowDown");
  check((await snap()).selected === "namib", "▼ back down to Namib");
  check((await page.locator("#hint-down").textContent()).includes("apps"), "tips: ▼ apps again");
  await key("ArrowUp");
  await sleep(1200);
  check(Math.abs((await globe("g.view.lon")) - 15.8) < 0.01, "the globe stays put");
  await key("Enter");
  check(await until(async () => (await page.locator("#dev-site").getAttribute("src")) === "https://www.window-swap.com/Window"), "WindowSwap's own player, full screen");
  check(await until(() => counters.swap === 1), "loaded once");
  check((await dev()).keepScreenOn, "keeps the TV on");
  await key("Enter");
  check(await until(() => counters.swap === 2), "OK -> another window");
  if (shots) await page.screenshot({ path: join(shots, "3-windowswap.png") });
  await key("Escape");
  check((await page.locator("#dev-site").count()) === 0 && (await snap()).view === "globe", "Back -> the globe");
  check(!(await dev()).keepScreenOn, "and the box may sleep again");

  console.log("◀ ▶ wrap round; a cam at night");
  await key("ArrowRight");
  s = await snap();
  check(s.selected === "kauai", "past the last one: the furthest west");
  await settled();
  check(Math.abs((await globe("g.view.lon")) + 159.5) < 0.01, "the globe turned the short way to Hawaii");
  check(/^🌙 (Night|Dawn) · sunrise in/.test(await page.locator("#preview-sun").textContent()), "🌙 with the time to sunrise");
  check(await page.locator('.marker.night[data-id="kauai"]').count() === 1, "a night dot");

  console.log("▼ -> the apps");
  await key("ArrowDown");
  check(await page.evaluate(() => document.body.classList.contains("view-apps")), "apps shown");
  await sleep(400);
  const box = await page.locator("#apps-panel").boundingBox();
  check(box && box.y < 1080 && box.y > 0, "slides up over the globe");
  check(await page.locator(".app").count() === 3, "the box's apps");
  check(await page.locator(".app.focus").getAttribute("data-id") === "@settings", "first one focused");
  await key("ArrowRight");
  if (shots) await page.screenshot({ path: join(shots, "4-apps.png") });
  await key("Enter");
  check((await dev()).launched.at(-1) === "com.google.android.youtube.tv", "OK launches it");
  await home();
  check((await snap()).view === "globe", "Home -> the globe");
  await key("ArrowDown");
  await key("ArrowUp");
  check((await snap()).view === "globe", "Up from the apps -> the globe");

  console.log("power off / on, before the network is back");
  await key("p");
  check((await snap()).power === "standby" && await page.locator("#standby").isVisible(), "standby: black screen");
  counters.offline = true;
  await key("p");
  check(await until(() => page.locator("#status").isVisible(), 5000), "a 'waiting for the internet' message");
  check((await page.locator("#status").textContent()) === "Waiting for the internet…Namib Desert Waterhole opens as soon as it's back", "naming the cam");
  await sleep(2500);
  check((await dev()).youtube.length === 2, "the YouTube app isn't opened into an error");
  if (shots) await page.screenshot({ path: join(shots, "5-waiting-for-network.png") });
  counters.offline = false;
  check(await until(async () => (await dev()).youtube.length === 3, 10000), "network back: the default opens");
  check((await dev()).youtube[2] === watch("NAMIB000001"), "the new default");
  check(await page.locator("#status").isHidden(), "message gone");
  await home();

  console.log("cam manager on a phone");
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await phone.goto(base + "/admin");
  await phone.waitForSelector("li.cam");
  check(await phone.locator("li.cam").count() === 5, "lists cams");
  check((await phone.locator("li.cam").first().textContent()).includes("on the globe at 42.48, -76.45"), "shows where each cam is");
  check(await phone.locator("#setup").isHidden(), "no setup notice when LampLauncher is the home app");
  await phone.fill("input[name=name]", "Tokyo Bay");
  await phone.fill("input[name=source]", "https://www.youtube.com/watch?v=abcdefghijk");
  await phone.fill("input[name=tz]", "Asia/Tokyo");
  await phone.fill("input[name=lat]", "35.6");
  await phone.fill("input[name=lon]", "139.8");
  await phone.click("#save");
  check(await until(async () => (await phone.locator("li.cam").count()) === 6, 5000), "adds a cam");
  check(await until(async () => (await page.locator(".marker.place").count()) === 5, 5000), "a new dot on the TV's globe");
  await phone.fill("input[name=name]", "Bad");
  await phone.fill("input[name=source]", "https://vimeo.com/1");
  await phone.click("#save");
  await sleep(500);
  check((await phone.locator("#form-error").textContent()).includes("YouTube"), "rejects a non-YouTube link");
  await phone.selectOption("select[name=preview]", "image");
  await phone.click("#prefs button[type=submit]");
  check(await until(async () => (await snap()).prefs.preview === "image", 5000), "still-only preview saved");
  const players = await page.evaluate(() => (window.__mockPlayers || []).length);
  await key("ArrowLeft");
  await sleep(2000);
  check(await page.evaluate(() => (window.__mockPlayers || []).length) === players, "no live preview then");
  check((await page.locator("#preview-still").evaluate((e) => e.style.backgroundImage)).includes("i.ytimg.com"), "just the still");

  console.log("assigning an extra remote button");
  await page.keyboard.press("b"); // KEYCODE_PROG_BLUE: not mapped yet
  await phone.reload();
  await phone.waitForSelector("li.cam");
  check((await phone.locator("#last-key").textContent()).includes("PROG_BLUE"), "cam manager shows the unknown button");
  await phone.selectOption("#assign-action", "menu");
  await phone.click("#assign-save");
  await sleep(500);
  const sel = (await snap()).selected;
  await key("b");
  check((await snap()).cams.find((c) => c.id === sel).favorite, "the blue button now makes a cam the default");
  if (shots) await phone.screenshot({ path: join(shots, "6-admin.png"), fullPage: true });
  await ctx.close();

  console.log("on a TV box (960x540 page pixels at a pixel ratio of 2)");
  const tvCtx = await seeded(browser, { width: 960, height: 540 }, 2);
  const tv = await openTv(tvCtx, "/", counters);
  check(await until(() => tv.evaluate(() => window.LampLauncher.view.globe.loaded), 10000), "globe drawn");
  const size = await tv.locator("#globe").evaluate((c) => ({ w: c.width, css: c.clientWidth, kind: document.body.dataset.globe }));
  const want = Math.round(size.css * 2 * (size.kind === "cpu" ? 0.5 : 1));
  check(size.w === want, `canvas at the screen's real resolution (${size.w} for ${size.css} page px)`);
  await tv.waitForTimeout(2500);
  if (shots) await tv.screenshot({ path: join(shots, "7-tv-box.png") });
  await tvCtx.close();

  console.log("without WebGL");
  const cpuCtx = await seeded(browser, { width: 1280, height: 720 });
  const cpu = await openTv(cpuCtx, "/?webgl=0", counters);
  check(await cpu.evaluate(() => document.body.dataset.globe) === "cpu", "draws it without WebGL");
  check(await until(() => cpu.evaluate(() => window.LampLauncher.view.globe.loaded), 10000), "pictures loaded");
  const px = await cpu.evaluate(() => window.LampLauncher.view.globe.pixel(0.5, 0.5));
  check(px[3] === 255 && px[0] + px[1] + px[2] > 40, `the Earth is there (${px})`);
  await cpuCtx.close();
} finally {
  await browser.close();
  server.kill();
}
if (failures) {
  console.log(`\n${failures} check(s) failed. Dev server log:\n${log}`);
  process.exit(1);
}
console.log("\nall UI checks passed");
