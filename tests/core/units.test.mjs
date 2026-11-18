// Unit tests for the pure-logic modules: run with `npm test`
import { test } from "node:test";
import assert from "node:assert/strict";

import { sunTimes, subsolarPoint, sunElevation } from "../../web/js/core/sun.js";
import * as day from "../../web/js/core/daylight.js";
import * as geo from "../../web/js/core/geo.js";
import { actionFor, isKnownKey } from "../../web/js/core/keys.js";
import { Store, cleanCam, ValidationError } from "../../web/js/core/store.js";
import {
  parseSource, parseLivePage, extractInitialData, findVideos, pickStream, Resolver,
} from "../../web/js/core/youtube.js";

// ---------------------------------------------------------------- sun
const at = (d, tz) => d.toLocaleTimeString("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit" });
function near(actual, expected, minutes = 4) {
  const toMin = (s) => s.split(":").map(Number).reduce((h, m) => h * 60 + m);
  assert.ok(Math.abs(toMin(actual) - toMin(expected)) <= minutes, `${actual} vs ${expected}`);
}

test("sunrise in Denver on the winter solstice", () => {
  const t = sunTimes({ year: 2026, month: 12, day: 21 }, 39.74, -104.99);
  near(at(t.sunrise, "America/Denver"), "07:18");
  near(at(t.sunset, "America/Denver"), "16:39");
});

test("sunrise in New York in summer", () => {
  near(at(sunTimes({ year: 2026, month: 6, day: 21 }, 40.71, -74.0).sunrise, "America/New_York"), "05:25");
});

test("polar night has no sunrise", () => {
  const t = sunTimes({ year: 2026, month: 12, day: 21 }, 69.65, 18.96);
  assert.equal(t.sunrise, null);
  assert.equal(t.polar, "night");
  assert.ok(t.noon instanceof Date);
});

// ------------------------------------------------------- sun position, day and night
const close = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);

test("the sun is overhead near the Tropic of Cancer at the June solstice, around the equator at the equinox", () => {
  const june = subsolarPoint(new Date(Date.UTC(2026, 5, 21, 12)));
  close(june.lat, 23.44, 0.1, "June latitude");
  close(june.lon, 0, 1, "noon UTC: over Greenwich, give or take the equation of time");
  const march = subsolarPoint(new Date(Date.UTC(2026, 2, 20, 18)));
  close(march.lat, 0, 0.5, "equinox latitude");
  close(march.lon, -90, 3, "18:00 UTC: over 90°W");
  const dec = subsolarPoint(new Date(Date.UTC(2026, 11, 21, 0)));
  close(dec.lat, -23.44, 0.1, "December latitude");
  close(Math.abs(dec.lon), 180, 2, "midnight UTC: over the date line");
});

test("the sun's height agrees with the sunrise equation", () => {
  // at sunrise (by the sunrise equation) the sun's centre is 0.833° below the horizon
  for (const [lat, lon] of [[42.48, -76.45], [-45.78, 170.7], [9.0, -79.5], [58.55, -155.79]]) {
    const t = sunTimes({ year: 2026, month: 11, day: 7 }, lat, lon);
    close(sunElevation(lat, lon, t.sunrise), -0.833, 0.35, `sunrise at ${lat},${lon}`);
    close(sunElevation(lat, lon, t.sunset), -0.833, 0.35, `sunset at ${lat},${lon}`);
    assert.ok(sunElevation(lat, lon, t.noon) > 10);
  }
});

const ITHACA = { lat: 42.48, lon: -76.45, tz: "America/New_York" };
test("day and night at a cam", () => {
  const morning = new Date(Date.UTC(2026, 10, 7, 14)); // 9:00 in Ithaca
  const night = new Date(Date.UTC(2026, 10, 8, 3)); // 22:00
  assert.equal(day.light(ITHACA, morning), "day");
  assert.equal(day.light(ITHACA, night), "night");
  assert.equal(day.light({ lat: null, lon: null }, night), null);
  assert.deepEqual(day.sunState(ITHACA, morning), { light: "day", icon: "☀", text: "Daylight" });
  const n = day.sunState(ITHACA, night);
  assert.equal(n.light, "night");
  assert.equal(n.icon, "🌙");
  assert.match(n.text, /^Night · sunrise in 8h \d\dm$/);
  const sunrise = sunTimes({ year: 2026, month: 11, day: 8 }, ITHACA.lat, ITHACA.lon).sunrise;
  assert.match(day.sunState(ITHACA, new Date(sunrise - 15 * 60000)).text, /^Dawn · sunrise in 1[45]m$/);
  const sunset = sunTimes({ year: 2026, month: 11, day: 7 }, ITHACA.lat, ITHACA.lon).sunset;
  assert.equal(day.sunState(ITHACA, new Date(sunset.getTime() + 10 * 60000)).text, "Dusk");
  close(day.nextSunrise(ITHACA, night) - sunrise, 0, 60000, "next sunrise");
  assert.equal(day.nextSunrise({ lat: 78.2, lon: 15.6 }, new Date(Date.UTC(2026, 11, 21))), null); // Svalbard in winter
});

test("cam clocks and durations", () => {
  const t = new Date(Date.UTC(2026, 10, 7, 14, 5));
  assert.match(day.camClock(ITHACA, t), /^0?9:05/);
  assert.equal(day.camClock({ tz: "Not/AZone" }, t), null);
  assert.equal(day.camClock({ tz: "" }, t), null);
  assert.ok(day.validZone("Pacific/Auckland"));
  assert.equal(day.formatDuration(45), "45m");
  assert.equal(day.formatDuration(120), "2h");
  assert.equal(day.formatDuration(125), "2h 05m");
  assert.equal(day.formatDuration(0.2), "1m");
});

// ---------------------------------------------------------------- globe geometry
test("a view centred on a place puts it in the middle, facing us", () => {
  for (const v of [{ lat: 0, lon: 0 }, { lat: 23, lon: -76.45 }, { lat: -25, lon: 170.7 }, { lat: 35, lon: -155.8 }]) {
    const m = geo.viewMatrix(v);
    const p = geo.project(m, v.lat, v.lon);
    close(p.x, 0, 1e-9, "x");
    close(p.y, 0, 1e-9, "y");
    close(p.z, 1, 1e-9, "z");
  }
  const m = geo.viewMatrix({ lat: 0, lon: 0 });
  const east = geo.project(m, 0, 30);
  assert.ok(east.x > 0.49 && Math.abs(east.y) < 1e-9, "east is to the right");
  assert.ok(geo.project(m, 30, 0).y > 0.49, "north is up");
  assert.ok(geo.project(m, 0, 180).z < -0.99, "the far side is hidden");
});

test("the view matrix is a rotation (its transpose undoes it)", () => {
  const m = geo.viewMatrix({ lat: 31, lon: -122 });
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      const dot = m[i * 3] * m[j * 3] + m[i * 3 + 1] * m[j * 3 + 1] + m[i * 3 + 2] * m[j * 3 + 2];
      close(dot, i === j ? 1 : 0, 1e-12, `rows ${i},${j}`);
    }
  }
});

test("longitudes wrap the short way round", () => {
  assert.equal(geo.normLon(190), -170);
  assert.equal(geo.normLon(-180), -180);
  assert.equal(geo.lonDelta(170, -170), 20);
  assert.equal(geo.lonDelta(-170, 170), -20);
  assert.equal(geo.lonDelta(10, 100), 90);
});

test("views tilt toward a cam's latitude, and the sun view faces the lit side", () => {
  assert.deepEqual(geo.camView({ lat: 58.55, lon: -155.79 }), { lat: 32.2025, lon: -155.79 });
  assert.equal(geo.camView({ lat: -80, lon: 0 }).lat, -35);
  const now = new Date(Date.UTC(2026, 10, 7, 17));
  const v = geo.sunView(now);
  const s = geo.toVec(subsolarPoint(now).lat, subsolarPoint(now).lon);
  const facing = geo.toVec(v.lat, v.lon);
  assert.ok(s[0] * facing[0] + s[1] * facing[1] + s[2] * facing[2] > 0.9, "looking at the sunlit side");
});

test("◀ ▶ order: west to east, then cams without a place", () => {
  const cams = [
    { id: "ws", lat: null, lon: null },
    { id: "nz", lat: -45.8, lon: 170.7 },
    { id: "ithaca", lat: 42.5, lon: -76.5 },
    { id: "brooks", lat: 58.55, lon: -155.79 },
    { id: "riffles", lat: 58.55, lon: -155.79 },
    { id: "kenya", lat: -2.5, lon: 37.75 },
  ];
  assert.deepEqual(geo.globeOrder(cams), ["brooks", "riffles", "ithaca", "kenya", "nz", "ws"]);
});

test("markers at the same or nearly the same place are spread apart", () => {
  const out = geo.spread([{ x: 100, y: 100 }, { x: 100, y: 100 }, { x: 300, y: 300 }], 20);
  close(Math.hypot(out[0].x - out[1].x, out[0].y - out[1].y), 20, 1e-9, "distance");
  assert.ok(out[0].x < out[1].x, "first one on the left");
  close((out[0].x + out[1].x) / 2, 100, 1e-9, "centred on the place");
  assert.deepEqual(out[2], { x: 300, y: 300 }, "far ones stay put");
  const near = geo.spread([{ x: 0, y: 0 }, { x: 0, y: 6 }], 20);
  assert.ok(near[1].y - near[0].y > 19.9, "pushed apart along the line between them");
  const three = geo.spread([{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 2, y: 4 }], 20);
  for (const [a, b] of [[0, 1], [0, 2], [1, 2]]) {
    assert.ok(Math.hypot(three[a].x - three[b].x, three[a].y - three[b].y) > 19.9, `pair ${a},${b}`);
  }
});

// ---------------------------------------------------------------- keys
test("Android key names map to actions", () => {
  assert.equal(actionFor("KEYCODE_DPAD_UP"), "up");
  assert.equal(actionFor("KEYCODE_DPAD_CENTER"), "ok");
  assert.equal(actionFor("KEYCODE_BACK"), "back");
  assert.equal(actionFor("KEYCODE_MENU"), "menu");
  assert.equal(actionFor("KEYCODE_VOLUME_UP"), null);
});

test("long press of OK opens the menu; repeats only for arrows", () => {
  assert.equal(actionFor("KEYCODE_DPAD_CENTER", { long: true }), "menu");
  assert.equal(actionFor("KEYCODE_DPAD_DOWN", { repeat: 3 }), "down");
  assert.equal(actionFor("KEYCODE_BACK", { repeat: 1 }), null);
});

test("user overrides for extra buttons", () => {
  const o = { KEYCODE_PROG_BLUE: "menu", KEYCODE_MEDIA_PLAY_PAUSE: "" };
  assert.equal(actionFor("KEYCODE_PROG_BLUE", {}, o), "menu");
  assert.equal(actionFor("KEYCODE_MEDIA_PLAY_PAUSE", {}, o), null);
  assert.ok(isKnownKey("KEYCODE_PROG_BLUE", o));
  assert.ok(!isKnownKey("KEYCODE_PROG_RED", o));
});

// ---------------------------------------------------------------- youtube
for (const [text, kind, value] of [
  ["dQw4w9WgXcQ", "video", "dQw4w9WgXcQ"],
  ["https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=4", "video", "dQw4w9WgXcQ"],
  ["https://youtu.be/dQw4w9WgXcQ", "video", "dQw4w9WgXcQ"],
  ["https://www.youtube.com/live/dQw4w9WgXcQ?si=x", "video", "dQw4w9WgXcQ"],
  ["youtube.com/embed/dQw4w9WgXcQ", "video", "dQw4w9WgXcQ"],
  ["@CornellBirdCams", "channel", "https://www.youtube.com/@CornellBirdCams"],
  ["https://www.youtube.com/@NamibiaCam/live", "channel", "https://www.youtube.com/@NamibiaCam"],
  ["https://m.youtube.com/channel/UCZXZQxS3d6NpR-eH_gdDwYA", "channel", "https://www.youtube.com/channel/UCZXZQxS3d6NpR-eH_gdDwYA"],
]) {
  test(`parseSource ${text}`, () => assert.deepEqual(parseSource(text), { kind, value }));
}

for (const text of ["", "https://vimeo.com/123", "not a url at all", "https://www.youtube.com/"]) {
  test(`parseSource rejects "${text}"`, () => assert.equal(parseSource(text), null));
}

test("channel /live page", () => {
  const live = '<link rel="canonical" href="https://www.youtube.com/watch?v=abcdefghijk"> "isLiveNow":true';
  assert.equal(parseLivePage(live), "abcdefghijk");
  assert.equal(parseLivePage(live.replace('"isLiveNow":true', '"isUpcoming":true')), null);
  assert.equal(parseLivePage('<link rel="canonical" href="https://www.youtube.com/@x">'), null);
});

function streamsPage() {
  const data = { contents: { tabs: [{ items: [
    { richItemRenderer: { content: { videoRenderer: {
      videoId: "AAAAAAAAAAA", title: { runs: [{ text: "Ontario FeederWatch Cam" }] },
      thumbnailOverlays: [{ thumbnailOverlayTimeStatusRenderer: { style: "LIVE" } }] } } } },
    { richItemRenderer: { content: { videoRenderer: {
      videoId: "BBBBBBBBBBB", title: { runs: [{ text: "Cornell Lab FeederWatch Cam at Sapsucker Woods" }] },
      badges: [{ metadataBadgeRenderer: { style: "BADGE_STYLE_TYPE_LIVE_NOW" } }] } } } },
    { lockupViewModel: { contentId: "CCCCCCCCCCC", metadata: { lockupMetadataViewModel: {
      title: { content: "Panama Fruit Feeder Cam" } } }, contentImage: { badges: [{ text: "LIVE" }] } } },
    { richItemRenderer: { content: { videoRenderer: {
      videoId: "DDDDDDDDDDD", title: { simpleText: "Panama highlights {recorded} \"quoted\"" } } } } },
  ] }] } };
  return `<script>var ytInitialData = ${JSON.stringify(data)};var other = {"a":1};</script>`;
}

test("channel /streams page: picks the matching live stream", () => {
  const videos = findVideos(extractInitialData(streamsPage()));
  assert.deepEqual(videos.map((v) => v.id), ["AAAAAAAAAAA", "BBBBBBBBBBB", "CCCCCCCCCCC", "DDDDDDDDDDD"]);
  assert.equal(pickStream(videos, "Cornell Lab FeederWatch|Sapsucker"), "BBBBBBBBBBB");
  assert.equal(pickStream(videos, "Ontario"), "AAAAAAAAAAA");
  assert.equal(pickStream(videos, "panama"), "CCCCCCCCCCC"); // live beats the recording
  assert.equal(pickStream(videos, ""), "AAAAAAAAAAA");
  assert.equal(pickStream(videos, "Kauai"), null);
});

test("resolver: channel lookups share one fetch, failures aren't cached", async () => {
  const pages = { "https://www.youtube.com/@Birds/streams": streamsPage() };
  let calls = 0;
  const fetchText = async (url) => {
    calls++;
    if (!(url in pages)) throw new Error("HTTP 404");
    return pages[url];
  };
  const r = new Resolver(fetchText);
  assert.equal(await r.resolve("@Birds", "Ontario"), "AAAAAAAAAAA");
  assert.equal(await r.resolve("@Birds", "Panama"), "CCCCCCCCCCC");
  assert.equal(calls, 1);
  assert.equal(await r.resolve("@Nobody", ""), null); // /live and /streams both fail
  assert.equal(await r.resolve("dQw4w9WgXcQ"), "dQw4w9WgXcQ");
});

// ---------------------------------------------------------------- store
test("store round trip", () => {
  let saved = null;
  const s = new Store(null, (j) => { saved = j; });
  assert.equal(s.favorite, "sapsucker-woods");
  const cam = s.addCam({ name: "My Bird Cam", source: "https://youtu.be/dQw4w9WgXcQ", tz: "America/New_York", lat: "40", lon: "-74" });
  assert.equal(cam.id, "my-bird-cam");
  assert.equal(cam.lat, 40);
  assert.equal(s.addCam({ name: "My Bird Cam", source: "dQw4w9WgXcQ" }).id, "my-bird-cam-2");
  s.setFavorite("my-bird-cam");
  s.moveCam("my-bird-cam", -1);
  const s2 = new Store(saved);
  assert.equal(s2.favorite, "my-bird-cam");
  assert.equal(s2.indexOf("my-bird-cam"), s2.cams.length - 3);
  s2.deleteCam("my-bird-cam");
  assert.equal(s2.favorite, null);
  assert.equal(s2.cam("my-bird-cam"), null);
});

test("the starter cams all have a place on the globe, except WindowSwap", () => {
  const s = new Store(null);
  for (const c of s.cams) {
    if (c.type === "windowswap") assert.equal(c.lat, null);
    else assert.ok(day.onGlobe(c) && day.validZone(c.tz), c.id);
  }
});

for (const bad of [
  { name: "x", type: "youtube", source: "https://vimeo.com/1" },
  { name: "x", type: "web", source: "ftp://example.com" },
  { name: "x", source: "@a", lat: "123" },
  { name: "x", source: "@a", lat: "north" },
  { name: "x", source: "@a", match: "(" },
  { name: "x", source: "@a", tz: "Mars/Olympus" },
]) {
  test(`store rejects ${JSON.stringify(bad)}`, () => {
    assert.throws(() => cleanCam(bad), ValidationError);
  });
}

test("broken state starts fresh", () => {
  const s = new Store("{not json");
  assert.ok(s.cams.length > 0);
  assert.equal(s.prefs.preview, "video");
});

test("state from the rewind version keeps the cams and the default, drops the rest", () => {
  const old = JSON.stringify({
    version: 2, favorite: "a", cams: [{ id: "a", name: "A", type: "youtube", source: "dQw4w9WgXcQ", lat: 1, lon: 2, tz: "" }],
    cam_settings: { a: { rewind_mode: "sunrise", sunrise_after: 45 } }, caps: { a: { v: 2, dvr: false } },
    resolved: { a: { video_id: "dQw4w9WgXcQ", at: 1 } }, prefs: { quality: "1080", sortByDaylight: false }, keys: { KEYCODE_PROG_BLUE: "menu" },
  });
  let saved = null;
  const s = new Store(old, (j) => { saved = j; });
  assert.equal(s.favorite, "a");
  assert.deepEqual(s.prefs, { preview: "video" });
  assert.equal(s.keys.KEYCODE_PROG_BLUE, "menu");
  assert.equal(s.resolved("a"), "dQw4w9WgXcQ");
  s.setFavorite("a");
  const data = JSON.parse(saved);
  assert.equal(data.version, 3);
  assert.ok(!("cam_settings" in data) && !("caps" in data));
});

test("prefs and key overrides validate", () => {
  const s = new Store(null);
  s.setPrefs({ preview: "image" });
  assert.equal(s.prefs.preview, "image");
  assert.throws(() => s.setPrefs({ preview: "hologram" }), ValidationError);
  s.setKey("KEYCODE_PROG_BLUE", "menu");
  assert.equal(s.keys.KEYCODE_PROG_BLUE, "menu");
  s.setKey("KEYCODE_PROG_BLUE", "default");
  assert.ok(!("KEYCODE_PROG_BLUE" in s.keys));
  assert.throws(() => s.setKey("rm -rf", "menu"), ValidationError);
});
