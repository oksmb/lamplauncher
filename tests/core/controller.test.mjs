// The remote-control state machine with a fake box, fake YouTube and a fake clock.
import { test } from "node:test";
import assert from "node:assert/strict";

import { Controller, APP_COLUMNS } from "../../web/js/core/controller.js";
import { Store } from "../../web/js/core/store.js";

const CAMS = [
  { id: "feeder", name: "Feeder", location: "Ithaca", type: "youtube", source: "@Birds", match: "Feeder",
    tz: "America/New_York", lat: 42.48, lon: -76.45 },
  { id: "namib", name: "Namib", location: "Namibia", type: "youtube", source: "https://youtu.be/NAMIB000001", match: "",
    tz: "Africa/Windhoek", lat: -24.6, lon: 15.8 },
  { id: "nz", name: "Albatross", location: "Otago", type: "youtube", source: "ALBATROSS01", match: "",
    tz: "Pacific/Auckland", lat: -45.78, lon: 170.7 },
  { id: "windowswap", name: "WindowSwap", location: "", type: "windowswap", source: "", match: "",
    tz: "", lat: null, lon: null },
  { id: "offline", name: "Offline", location: "", type: "youtube", source: "@Gone", match: "", tz: "", lat: null, lon: null },
];
// 10:00 in Ithaca, 17:00 in Namibia (both light), 04:00 in New Zealand (dark)
const MORNING_ITHACA = Date.UTC(2026, 10, 7, 15);
// 22:00 in Ithaca, 05:00 in Namibia (before sunrise), 16:00 in New Zealand (light)
const NIGHT_ITHACA = Date.UTC(2026, 10, 8, 3);
const watch = (id) => `https://www.youtube.com/watch?v=${id}`;

class FakeBox {
  constructor() {
    this.site = null;
    this.keepOn = false;
    this.evals = [];
    this.launched = [];
    this.youtube = [];
    this.woken = 0;
    this.net = true; // can YouTube be reached?
    this.netChecks = 0;
  }
  online() {
    this.netChecks++;
    return Promise.resolve(this.net);
  }
  openYouTube(url) { this.youtube.push(url); }
  showSite(url) { this.site = url; }
  hideSite() { this.site = null; }
  siteEval(js) { this.evals.push(js); }
  setKeepScreenOn(on) { this.keepOn = on; }
  launchApp(id) { this.launched.push(id); }
  wakeScreen() { this.woken++; }
}

const flush = () => new Promise((r) => setImmediate(r));

function rig({ favorite = "feeder", cams = CAMS, t = MORNING_ITHACA, apps = 7, resolver, sleep } = {}) {
  const state = JSON.stringify({ cams, favorite, resolved: {}, prefs: {} });
  let saved = state;
  const store = new Store(state, (j) => { saved = j; });
  const ids = { "@Birds|Feeder": "FEEDER00001" };
  resolver ||= { calls: 0, async resolve(src, match) { this.calls++; return ids[`${src}|${match}`] || (/^@/.test(src) ? null : src.slice(-11)); } };
  const box = new FakeBox();
  const clock = { t };
  const ctl = new Controller({
    store, resolver, platform: box, now: () => clock.t,
    sleep: sleep || (() => new Promise(() => {})), // the resolve timeout never fires unless a test wants it
  });
  ctl.setApps(Array.from({ length: apps }, (_, i) => ({ id: `app${i}`, label: `App ${i}` })));
  const toasts = [];
  ctl.subscribe((m) => { if (m.type === "toast") toasts.push(m.text); });
  return { ctl, store, box, clock, toasts, resolver, saved: () => JSON.parse(saved) };
}

/** Boots as the TV page does, then lets async work settle. */
async function booted(opts = {}, boot = { wake: false }) {
  const r = rig(opts);
  r.ctl.refreshAll(); // (main.js: controller.start())
  r.ctl.boot(boot);
  await flush();
  return r;
}

// ------------------------------------------------------------------ waking up
test("switching on opens the default cam in the YouTube app", async () => {
  const { ctl, box } = await booted({ favorite: "namib" }, { wake: true });
  assert.equal(ctl.power, "on");
  assert.deepEqual(box.youtube, [watch("NAMIB000001")]);
  assert.equal(ctl.view, "globe", "the globe waits behind the YouTube app");
  assert.equal(ctl.selected, "namib");
});

test("a channel cam is looked up first, so the YouTube app gets today's stream", async () => {
  const { box, resolver } = await booted({}, { wake: true });
  assert.deepEqual(box.youtube, [watch("FEEDER00001")]);
  assert.ok(resolver.calls >= 1);
});

test("Android restarting LampLauncher (not a wake-up) shows the globe and opens nothing", async () => {
  const { ctl, box } = await booted({}, { wake: false });
  assert.equal(ctl.power, "on");
  assert.equal(ctl.view, "globe");
  assert.deepEqual(box.youtube, []);
});

test("with the screen off at start, it waits for the screen", async () => {
  const { ctl, box, clock } = await booted({}, { screenOn: false, wake: true });
  assert.equal(ctl.power, "standby");
  clock.t += 3600_000;
  ctl.lifecycle("screen_on");
  await flush();
  assert.deepEqual(box.youtube, [watch("FEEDER00001")]);
});

test("no default cam: switching on shows the globe", async () => {
  const { ctl, box } = await booted({ favorite: null }, { wake: true });
  assert.equal(ctl.power, "on");
  assert.deepEqual(box.youtube, []);
  assert.equal(ctl.selected, "namib", "the cam where the sun is highest (17:00 there, 10:00 in Ithaca)");
});

test("the globe starts on the sunny side: the default cam if it's light there, else where the sun is highest", async () => {
  assert.equal((await booted({ t: MORNING_ITHACA })).ctl.selected, "feeder");
  assert.equal((await booted({ t: NIGHT_ITHACA })).ctl.selected, "nz");
  // opening the default doesn't move the globe to it when it's dark there
  const { ctl, box } = await booted({ t: NIGHT_ITHACA }, { wake: true });
  assert.deepEqual(box.youtube, [watch("FEEDER00001")]);
  assert.equal(ctl.selected, "nz");
});

test("power off and on: standby, then the default cam again", async () => {
  const { ctl, box, clock } = await booted({}, { wake: true });
  ctl.lifecycle("stop"); // the YouTube app is in front
  ctl.lifecycle("screen_off");
  ctl.lifecycle("stop");
  assert.equal(ctl.power, "standby");
  clock.t += 8 * 3600_000;
  // the box wakes and brings its home app (LampLauncher) to the front
  ctl.lifecycle("screen_on");
  assert.deepEqual(box.youtube.length, 1, "not behind the YouTube app");
  ctl.lifecycle("start");
  ctl.lifecycle("home_intent");
  await flush();
  assert.equal(box.youtube.length, 2);
  assert.equal(box.youtube[1], watch("FEEDER00001"));
});

test("the screen coming on while LampLauncher is in front opens the default once", async () => {
  const { ctl, box, clock } = await booted({ favorite: "namib" });
  ctl.lifecycle("screen_off");
  clock.t += 3600_000;
  ctl.lifecycle("start"); // order varies by box
  ctl.lifecycle("screen_on");
  ctl.lifecycle("home_intent");
  await flush();
  assert.deepEqual(box.youtube, [watch("NAMIB000001")]);
});

test("waking up behind another app, much later back to LampLauncher: just the globe", async () => {
  const { ctl, box, clock } = await booted();
  ctl.lifecycle("stop");
  ctl.lifecycle("screen_off");
  ctl.lifecycle("screen_on");
  clock.t += 60_000;
  ctl.lifecycle("start");
  await flush();
  assert.deepEqual(box.youtube, []);
  assert.equal(ctl.view, "globe");
});

// ------------------------------------------- waiting for the network after waking up
/** A rig whose waits between network checks only end when the test says so. */
function slowNet(opts = {}) {
  const waits = [];
  const r = rig({ ...opts, sleep: () => new Promise((res) => waits.push(res)) });
  r.next = async () => {
    for (const w of waits.splice(0)) w();
    await flush();
  };
  return r;
}

test("switched on before the network is up: waits for YouTube, then opens the default", async () => {
  const r = slowNet();
  r.box.net = false;
  r.ctl.boot({ wake: true });
  await flush();
  assert.deepEqual(r.box.youtube, [], "not into a YouTube error screen");
  assert.equal(r.ctl.snapshot().waiting.cam, "feeder");
  assert.equal(r.ctl.snapshot().waiting.name, "Feeder");
  r.clock.t += 20_000;
  await r.next(); // still down
  assert.equal(r.box.netChecks, 2);
  assert.equal(r.ctl.snapshot().waiting.seconds, 20);
  const lookups = r.resolver.calls;
  r.box.net = true;
  await r.next();
  assert.deepEqual(r.box.youtube, [watch("FEEDER00001")]);
  assert.equal(r.ctl.snapshot().waiting, null);
  assert.ok(r.resolver.calls > lookups, "looks up the channel cams again (that failed while offline)");
});

test("waiting for the network: another button stops it, OK on a cam still opens that cam", async () => {
  const r = slowNet();
  r.box.net = false;
  r.ctl.boot({ wake: true });
  await flush();
  r.ctl.key("KEYCODE_DPAD_RIGHT");
  assert.equal(r.ctl.snapshot().waiting, null, "stopped waiting");
  r.box.net = true;
  await r.next();
  assert.deepEqual(r.box.youtube, [], "the default doesn't open after all");
  r.box.net = false;
  r.ctl.key("KEYCODE_DPAD_CENTER"); // namib
  await flush();
  assert.equal(r.ctl.snapshot().waiting.cam, "namib");
  r.box.net = true;
  await r.next();
  assert.deepEqual(r.box.youtube, [watch("NAMIB000001")]);
});

test("waiting for the network: turning the TV off stops it", async () => {
  const r = slowNet();
  r.box.net = false;
  r.ctl.boot({ wake: true });
  await flush();
  r.ctl.lifecycle("screen_off");
  r.box.net = true;
  await r.next();
  assert.deepEqual(r.box.youtube, []);
  assert.equal(r.ctl.snapshot().waiting, null);
});

test("a recent network check is trusted; waking up checks again", async () => {
  const { ctl, box, clock } = await booted({}, { wake: true });
  assert.equal(box.netChecks, 1);
  clock.t += 60_000;
  ctl.lifecycle("home_intent");
  ctl.key("KEYCODE_DPAD_RIGHT");
  ctl.key("KEYCODE_DPAD_CENTER");
  await flush();
  assert.equal(box.youtube.length, 2);
  assert.equal(box.netChecks, 1, "no need to check again a minute later");
  ctl.lifecycle("screen_off");
  clock.t += 8 * 3600_000;
  ctl.lifecycle("screen_on");
  await flush();
  assert.equal(box.netChecks, 2, "checked again after waking up");
  assert.equal(box.youtube.length, 3);
});

test("WindowSwap waits for the network too", async () => {
  const r = slowNet({ favorite: "windowswap" });
  r.box.net = false;
  r.ctl.boot({ wake: true });
  await flush();
  assert.equal(r.box.site, null);
  assert.equal(r.ctl.snapshot().waiting.cam, "windowswap");
  r.box.net = true;
  await r.next();
  assert.equal(r.box.site, "https://www.window-swap.com/Window");
});

// --------------------------------------------- coming back from the YouTube app
test("Home in the YouTube app comes back to the globe, on the cam you were watching", async () => {
  const { ctl, box, clock } = await booted();
  ctl.key("KEYCODE_DPAD_RIGHT");
  assert.equal(ctl.selected, "namib");
  ctl.key("KEYCODE_DPAD_CENTER");
  await flush();
  assert.deepEqual(box.youtube, [watch("NAMIB000001")]);
  ctl.lifecycle("stop");
  clock.t += 20 * 60_000;
  ctl.lifecycle("start");
  ctl.lifecycle("home_intent");
  await flush();
  assert.equal(box.youtube.length, 1, "nothing re-opens");
  assert.equal(ctl.view, "globe");
  assert.equal(ctl.selected, "namib");
});

test("Home soon after waking up is part of waking up (ignored)", async () => {
  const { ctl, box, clock } = await booted({}, { wake: true });
  clock.t += 3000;
  ctl.lifecycle("home_intent");
  ctl.lifecycle("start");
  await flush();
  assert.equal(box.youtube.length, 1);
});

// ------------------------------------------------------------------ the globe
test("◀ ▶ go round the cams on the globe, west to east, and wrap", async () => {
  const { ctl } = await booted();
  assert.deepEqual(ctl.order(), ["feeder", "namib", "nz", "windowswap", "offline"]);
  assert.deepEqual(ctl.placedOrder(), ["feeder", "namib", "nz"]);
  const seen = [];
  for (let i = 0; i < 4; i++) {
    ctl.key("KEYCODE_DPAD_RIGHT");
    seen.push(ctl.selected);
  }
  assert.deepEqual(seen, ["namib", "nz", "feeder", "namib"]);
  ctl.key("KEYCODE_DPAD_LEFT");
  ctl.key("KEYCODE_DPAD_LEFT");
  assert.equal(ctl.selected, "nz");
  ctl.key("KEYCODE_MEDIA_NEXT");
  assert.equal(ctl.selected, "feeder");
});

test("▲ goes up to the cams beside the globe; ▼ back down; ◀ ▶ carry on from where you were", async () => {
  const { ctl, box } = await booted();
  ctl.key("KEYCODE_DPAD_RIGHT"); // namib
  ctl.key("KEYCODE_DPAD_UP");
  assert.equal(ctl.selected, "windowswap", "▲ only moves the cursor");
  assert.equal(ctl.view, "globe");
  assert.equal(box.site, null);
  ctl.key("KEYCODE_DPAD_UP");
  assert.equal(ctl.selected, "offline", "▲ again: the next one beside the globe");
  ctl.key("KEYCODE_DPAD_UP");
  assert.equal(ctl.selected, "windowswap");
  ctl.key("KEYCODE_DPAD_DOWN");
  assert.equal(ctl.selected, "namib", "▼ back to the cam you were on");
  assert.equal(ctl.view, "globe", "not the apps");
  ctl.key("KEYCODE_DPAD_UP");
  ctl.key("KEYCODE_DPAD_RIGHT");
  assert.equal(ctl.selected, "nz", "▶ from up there: the next cam after the one you were on");
  ctl.key("KEYCODE_DPAD_UP");
  ctl.key("KEYCODE_DPAD_LEFT");
  assert.equal(ctl.selected, "namib", "◀ likewise");
  ctl.key("KEYCODE_DPAD_UP");
  ctl.key("KEYCODE_DPAD_CENTER");
  await flush();
  assert.equal(ctl.view, "site", "OK opens it");
  ctl.key("KEYCODE_BACK");
  ctl.key("KEYCODE_DPAD_DOWN");
  assert.equal(ctl.selected, "namib", "back from WindowSwap, ▼ still returns to the globe");
  ctl.key("KEYCODE_DPAD_DOWN");
  assert.equal(ctl.view, "apps", "and ▼ on the globe opens the apps");
});

test("starting on a cam beside the globe, ▼ goes to where the sun is highest", async () => {
  const { ctl } = await booted({ favorite: "windowswap" });
  assert.equal(ctl.selected, "windowswap");
  ctl.key("KEYCODE_DPAD_DOWN");
  assert.equal(ctl.selected, "namib");
});

test("no cams beside the globe: ▲ does nothing", async () => {
  const { ctl } = await booted({ cams: CAMS.slice(0, 3) });
  ctl.key("KEYCODE_DPAD_UP");
  assert.equal(ctl.selected, "feeder");
});

test("held arrows keep moving; Back does nothing on the globe", async () => {
  const { ctl, box } = await booted();
  ctl.key("KEYCODE_DPAD_RIGHT", { repeat: 1 });
  ctl.key("KEYCODE_DPAD_RIGHT", { repeat: 2 });
  assert.equal(ctl.selected, "nz");
  ctl.key("KEYCODE_BACK");
  assert.equal(ctl.view, "globe");
  assert.equal(ctl.selected, "nz");
  assert.deepEqual(box.youtube, []);
});

test("hold OK makes a cam the default (a star); again removes it", async () => {
  const { ctl, store, toasts, saved } = await booted();
  ctl.key("KEYCODE_DPAD_RIGHT");
  ctl.key("KEYCODE_DPAD_CENTER", { long: true });
  assert.equal(store.favorite, "namib");
  assert.equal(saved().favorite, "namib");
  assert.match(toasts.at(-1), /Namib now opens when you turn on the TV/);
  const snap = ctl.snapshot();
  assert.deepEqual(snap.cams.filter((c) => c.favorite).map((c) => c.id), ["namib"]);
  ctl.key("KEYCODE_DPAD_CENTER", { long: true });
  assert.equal(store.favorite, null);
  assert.match(toasts.at(-1), /no longer the default/);
});

test("OK on a channel cam waits for its current stream; another button cancels", async () => {
  let release;
  const resolver = { resolve: () => new Promise((r) => { release = r; }) };
  const { ctl, box, toasts } = await booted({ resolver });
  ctl.key("KEYCODE_DPAD_CENTER"); // feeder: a channel
  await flush();
  assert.equal(ctl.opening, "feeder");
  assert.equal(ctl.snapshot().opening, "feeder");
  ctl.key("KEYCODE_DPAD_RIGHT");
  release("FEEDER00001");
  await flush();
  assert.deepEqual(box.youtube, [], "cancelled");
  assert.equal(ctl.opening, null);
  assert.ok(!toasts.some((t) => /Opening/.test(t)));
});

test("a slow lookup falls back to the stream found last time", async () => {
  const resolver = { resolve: () => new Promise(() => {}) };
  const r = rig({ resolver, sleep: () => Promise.resolve() });
  r.store.setResolved("feeder", "OLDSTREAM01", 0);
  r.ctl.boot({ wake: false });
  r.ctl.key("KEYCODE_DPAD_CENTER");
  await flush();
  assert.deepEqual(r.box.youtube, [watch("OLDSTREAM01")]);
});

test("a channel with no live stream found: tries the channel's live page", async () => {
  const { ctl, box, toasts } = await booted();
  ctl.key("KEYCODE_DPAD_UP");
  ctl.key("KEYCODE_DPAD_UP"); // offline
  ctl.key("KEYCODE_DPAD_CENTER");
  await flush();
  assert.deepEqual(box.youtube, ["https://www.youtube.com/@Gone/live"]);
  assert.match(toasts.at(-1), /Couldn't find Offline's live stream/);
});

test("the snapshot: cams in globe order, with day/night, local time and a still", async () => {
  const { ctl } = await booted();
  const s = ctl.snapshot();
  assert.equal(s.view, "globe");
  assert.equal(s.selected, "feeder");
  const byId = Object.fromEntries(s.cams.map((c) => [c.id, c]));
  assert.deepEqual(s.cams.map((c) => c.id), ctl.order());
  assert.equal(byId.feeder.light, "day");
  assert.equal(byId.feeder.sun, "☀ Daylight");
  assert.match(byId.feeder.clock, /^10:00/);
  assert.equal(byId.feeder.video_id, "FEEDER00001");
  assert.equal(byId.feeder.thumb, "https://i.ytimg.com/vi/FEEDER00001/hqdefault_live.jpg");
  assert.equal(byId.nz.light, "night");
  assert.match(byId.nz.sun, /^🌙 (Night|Dawn) · sunrise in/);
  assert.equal(byId.windowswap.lat, null);
  assert.equal(byId.windowswap.sun, "");
  assert.equal(byId.offline.status, "offline");
  assert.equal(s.prefs.preview, "video");
});

// ------------------------------------------------------------------ apps
test("▼ opens the apps; arrows move in rows; Up from the top row or Back returns", async () => {
  const { ctl, box } = await booted({ apps: 7 });
  assert.equal(APP_COLUMNS, 5);
  ctl.key("KEYCODE_DPAD_DOWN");
  assert.equal(ctl.view, "apps");
  assert.equal(ctl.appIndex, 0);
  ctl.key("KEYCODE_DPAD_RIGHT");
  ctl.key("KEYCODE_DPAD_RIGHT");
  ctl.key("KEYCODE_DPAD_RIGHT");
  ctl.key("KEYCODE_DPAD_DOWN");
  assert.equal(ctl.appIndex, 6, "short last row: the last app");
  ctl.key("KEYCODE_DPAD_RIGHT");
  assert.equal(ctl.appIndex, 6);
  ctl.key("KEYCODE_DPAD_UP");
  assert.equal(ctl.appIndex, 1);
  ctl.key("KEYCODE_DPAD_CENTER");
  assert.deepEqual(box.launched, ["app1"]);
  ctl.key("KEYCODE_DPAD_UP");
  assert.equal(ctl.view, "globe");
  ctl.key("KEYCODE_DPAD_DOWN");
  assert.equal(ctl.appIndex, 1, "remembers where you were");
  ctl.key("KEYCODE_BACK");
  assert.equal(ctl.view, "globe");
});

test("no apps: ▼ stays on the globe", async () => {
  const { ctl } = await booted({ apps: 0 });
  ctl.key("KEYCODE_DPAD_DOWN");
  assert.equal(ctl.view, "globe");
});

test("Home from another app lands on the globe", async () => {
  const { ctl, clock } = await booted();
  ctl.key("KEYCODE_DPAD_DOWN");
  ctl.key("KEYCODE_DPAD_CENTER");
  ctl.lifecycle("stop");
  clock.t += 60_000;
  ctl.lifecycle("start");
  assert.equal(ctl.view, "apps", "Back from the app: where you were");
  ctl.lifecycle("home_intent");
  assert.equal(ctl.view, "globe");
});

// ------------------------------------------------------------------ WindowSwap
test("WindowSwap opens full screen; OK for another window; Back to the globe", async () => {
  const { ctl, box, toasts } = await booted();
  ctl.key("KEYCODE_DPAD_UP");
  assert.equal(ctl.selected, "windowswap");
  ctl.key("KEYCODE_DPAD_CENTER");
  await flush();
  assert.equal(ctl.view, "site");
  assert.equal(box.site, "https://www.window-swap.com/Window");
  assert.equal(box.keepOn, true, "the TV stays on while it plays");
  ctl.key("KEYCODE_DPAD_CENTER");
  ctl.key("KEYCODE_DPAD_RIGHT");
  assert.deepEqual(box.evals, ["location.reload()", "location.reload()"]);
  assert.match(toasts.at(-1), /another window/);
  ctl.key("KEYCODE_DPAD_CENTER", { long: true });
  assert.equal(ctl.store.favorite, "windowswap");
  ctl.key("KEYCODE_BACK");
  assert.equal(ctl.view, "globe");
  assert.equal(box.site, null);
  assert.equal(box.keepOn, false);
  assert.deepEqual(box.youtube, []);
});

test("WindowSwap as the default opens when switched on, and hides behind other apps", async () => {
  const { ctl, box } = await booted({ favorite: "windowswap" }, { wake: true });
  assert.equal(ctl.view, "site");
  assert.equal(box.site, "https://www.window-swap.com/Window");
  ctl.lifecycle("stop");
  assert.equal(box.site, null);
  ctl.lifecycle("screen_off");
  assert.equal(ctl.power, "standby");
  assert.equal(box.keepOn, false);
});

// ------------------------------------------------------------------ the cam manager
test("cam manager: list, add, edit, default, delete", async () => {
  const { ctl, store } = await booted();
  const list = await ctl.api("GET", "/api/cams");
  assert.equal(list.status, 200);
  assert.equal(list.body.cams.length, 5);
  assert.equal(list.body.favorite, "feeder");
  const added = await ctl.api("POST", "/api/cams", { name: "Kauai", source: "dQw4w9WgXcQ", lat: "22.1", lon: "-159.5", tz: "Pacific/Honolulu" });
  assert.equal(added.status, 200);
  assert.deepEqual(ctl.order().slice(0, 2), ["kauai", "feeder"], "furthest west first");
  const bad = await ctl.api("POST", "/api/cams", { name: "x", source: "https://vimeo.com/1" });
  assert.equal(bad.status, 400);
  assert.equal((await ctl.api("PUT", "/api/cams/kauai", { name: "Kauai Coast" })).body.name, "Kauai Coast");
  assert.deepEqual((await ctl.api("POST", "/api/cams/kauai/favorite")).body, { favorite: "kauai" });
  ctl.key("KEYCODE_DPAD_LEFT");
  assert.equal(ctl.selected, "kauai");
  assert.equal((await ctl.api("DELETE", "/api/cams/kauai")).status, 200);
  assert.equal(store.favorite, null);
  assert.ok(store.cam(ctl.selected), "the globe picks another cam");
  assert.equal((await ctl.api("DELETE", "/api/cams/kauai")).status, 404);
  assert.equal((await ctl.api("GET", "/api/nope")).status, 404);
});

test("cam manager: open a cam on the TV, even from standby (without the default first)", async () => {
  const { ctl, box } = await booted({}, { screenOn: false });
  const r = await ctl.api("POST", "/api/cams/nz/play");
  await flush();
  assert.equal(r.status, 200);
  assert.equal(box.woken, 1);
  assert.deepEqual(box.youtube, [watch("ALBATROSS01")]);
  assert.equal(ctl.selected, "nz");
});

test("cam manager: remote buttons, preferences and checking a link", async () => {
  const { ctl, box, store } = await booted({}, { screenOn: false });
  assert.equal((await ctl.api("POST", "/api/action/power")).body.power, "on");
  await flush();
  assert.equal(box.woken, 1);
  assert.deepEqual(box.youtube, [watch("FEEDER00001")], "the power button opens the default");
  assert.equal((await ctl.api("POST", "/api/action/right")).status, 200);
  assert.equal(ctl.selected, "namib");
  assert.equal((await ctl.api("POST", "/api/action/fly")).status, 400);
  assert.equal((await ctl.api("POST", "/api/action/power")).body.power, "standby");
  const prefs = await ctl.api("PUT", "/api/prefs", { prefs: { preview: "image" }, keys: { KEYCODE_PROG_BLUE: "menu" } });
  assert.equal(prefs.status, 200);
  assert.equal(store.prefs.preview, "image");
  assert.equal(ctl.snapshot().prefs.preview, "image");
  assert.equal((await ctl.api("PUT", "/api/prefs", { prefs: { preview: "3d" } })).status, 400);
  assert.equal((await ctl.api("PUT", "/api/prefs", { keys: { KEYCODE_PROG_RED: "teleport" } })).status, 400);
  const check = await ctl.api("POST", "/api/check", { source: "@Birds", match: "Feeder" });
  assert.deepEqual(check.body, { ok: true, kind: "channel", video_id: "FEEDER00001", error: null });
  assert.equal((await ctl.api("POST", "/api/check", { source: "nope" })).body.ok, false);
});

test("an assigned extra button works; unknown buttons are noted for the cam manager", async () => {
  const { ctl, store } = await booted();
  ctl.key("KEYCODE_PROG_RED");
  assert.equal(ctl.lastUnknownKey.key, "KEYCODE_PROG_RED");
  store.setKey("KEYCODE_PROG_BLUE", "menu");
  ctl.key("KEYCODE_PROG_BLUE");
  assert.equal(store.favorite, null, "toggled the default off");
});
