// Draws the controller's snapshots: the globe with a marker for every cam, the
// preview card for the selected one, the apps list and the messages.
import { createGlobe, GLOBE_SCALE } from "./globe.js";
import { createPreview } from "./preview.js";
import { project, spread, camView, sunView } from "../core/geo.js";

const $ = (id) => document.getElementById(id);
const ICONS = {
  star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1.6l3.15 6.6 7.25.95-5.3 5.02 1.36 7.18L12 17.86l-6.46 3.49 1.36-7.18-5.3-5.02 7.25-.95z"/></svg>',
  window: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="3.5" width="16" height="17" rx="1.6"/><path d="M12 3.5v17M4 11h16"/></svg>',
  web: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.6 2.4 3.7 5.2 3.7 8.5s-1.1 6.1-3.7 8.5M12 3.5c-2.6 2.4-3.7 5.2-3.7 8.5s1.1 6.1 3.7 8.5"/></svg>',
};

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

/** @param {{webgl?: boolean}} o webgl: false draws the globe without WebGL (for testing) */
export function createView({ webgl = true } = {}) {
  let state = null;
  let camsKey = "";
  let appsKey = "";
  let target = null; // the view the globe is turned to, "lat,lon"
  let placed = []; // markers of cams on the globe: {cam, el, x, y, z}
  let sats = []; // cams without a place on it (WindowSwap), in orbit beside it
  let geometry = null; // the globe on screen: {cx, cy, r} in CSS pixels
  const timers = {};
  const preview = createPreview({ still: $("preview-still"), live: $("preview-live") });
  const globe = createGlobe($("globe"), {
    dayUrl: "img/earth-day.jpg",
    nightUrl: "img/earth-night.jpg",
    onFrame: placeMarkers,
    webgl,
  });
  document.body.dataset.globe = globe.kind;

  function measure() {
    const rect = $("globe").getBoundingClientRect();
    geometry = { cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2, r: (rect.width / 2) * GLOBE_SCALE };
  }

  function drawStars() {
    const c = $("stars");
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(window.innerWidth * dpr);
    c.height = Math.round(window.innerHeight * dpr);
    const ctx = c.getContext("2d");
    let seed = 20240607;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    ctx.clearRect(0, 0, c.width, c.height);
    const n = Math.round((c.width * c.height) / 5200);
    for (let i = 0; i < n; i++) {
      const x = rnd() * c.width;
      const y = rnd() * c.height;
      const big = rnd() < 0.06;
      const r = (big ? 0.9 + rnd() * 0.7 : 0.35 + rnd() * 0.5) * dpr;
      ctx.globalAlpha = big ? 0.55 + rnd() * 0.4 : 0.18 + rnd() * 0.45;
      ctx.fillStyle = rnd() < 0.15 ? "#ffe6c4" : rnd() < 0.2 ? "#cfe0ff" : "#ffffff";
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  window.addEventListener("resize", () => {
    measure();
    drawStars();
    globe.resize();
  });
  measure();
  drawStars();
  globe.resize();

  // ------------------------------------------------------------- markers
  /** Every frame the globe draws: put the markers where their places are now. */
  function placeMarkers(m) {
    if (!geometry) measure();
    const { cx, cy, r } = geometry;
    const visible = [];
    for (const p of placed) {
      const q = project(m, p.cam.lat, p.cam.lon);
      p.z = q.z;
      p.x = cx + q.x * r;
      p.y = cy - q.y * r;
      if (q.z > 0) visible.push(p);
    }
    // cams close together (or at the same place) side by side, not on top of each other
    const gap = window.innerHeight * 0.036; // clear of the selection ring
    const moved = spread(visible.map((p) => ({ x: p.x, y: p.y })), gap);
    visible.forEach((p, i) => {
      p.x = moved[i].x;
      p.y = moved[i].y;
    });
    for (const p of placed) {
      const show = Math.max(0, Math.min(1, (p.z - 0.04) / 0.16)); // fade out round the edge
      p.el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
      p.el.style.opacity = show.toFixed(2);
      p.el.classList.toggle("behind", show === 0);
    }
    // in orbit off the globe's upper left
    sats.forEach((p, i) => {
      const a = ((135 - i * 15) * Math.PI) / 180;
      p.x = cx + Math.cos(a) * r * 1.13;
      p.y = cy - Math.sin(a) * r * 1.13;
      p.el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
    });
  }

  function renderMarkers(s) {
    const key = JSON.stringify(s.cams.map((c) => [c.id, c.name, c.lat, c.lon, c.favorite, c.type]));
    if (key !== camsKey) {
      camsKey = key;
      const box = $("markers");
      box.textContent = "";
      placed = [];
      sats = [];
      for (const cam of s.cams) {
        const onGlobe = cam.lat != null;
        const m = el("div", `marker ${onGlobe ? "place" : "satellite"}${cam.favorite ? " favorite" : ""}`);
        m.dataset.id = cam.id;
        const dot = el("span", "dot");
        if (!onGlobe) dot.innerHTML = cam.type === "windowswap" ? ICONS.window : ICONS.web;
        else if (cam.favorite) dot.innerHTML = ICONS.star;
        m.append(el("span", "ring"), dot);
        if (!onGlobe && cam.favorite) {
          const badge = el("span", "badge");
          badge.innerHTML = ICONS.star;
          m.appendChild(badge);
        }
        box.appendChild(m);
        (onGlobe ? placed : sats).push({ cam, el: m, x: 0, y: 0, z: 0 });
      }
      globe.redraw();
    }
    const byId = new Map(s.cams.map((c) => [c.id, c]));
    for (const p of [...placed, ...sats]) {
      const c = byId.get(p.cam.id);
      p.el.classList.toggle("selected", c.id === s.selected);
      p.el.classList.toggle("night", c.light === "night");
    }
  }

  // --------------------------------------------------------------- globe
  function renderGlobe(s, prev) {
    if (!s.active) return; // another app is in front: nothing to draw
    const now = new Date(s.now);
    globe.setTime(now);
    const cam = s.cams.find((c) => c.id === s.selected);
    let want = null;
    if (cam && cam.lat != null) want = camView(cam);
    else if (!target) want = sunView(now); // (a cam without a place keeps the globe where it is)
    if (!want) return;
    const k = `${want.lat.toFixed(2)},${want.lon.toFixed(2)}`;
    if (k === target) return;
    const watching = Boolean(prev && prev.active && prev.power === "on" && prev.view === "globe" && target);
    target = k;
    globe.setView(want, { animate: watching });
  }

  // ------------------------------------------------------------- preview
  function renderPreview(s) {
    const cam = s.cams.find((c) => c.id === s.selected);
    $("preview").hidden = !cam;
    if (!cam) {
      preview.stop();
      return;
    }
    $("preview-name").textContent = cam.name;
    $("preview-where").textContent = [cam.location, cam.clock].filter(Boolean).join(" · ");
    const sun = $("preview-sun");
    sun.textContent = cam.sun || (cam.type === "windowswap" ? "Someone's window, somewhere" : "");
    sun.className = cam.light || "";
    $("preview-star").hidden = !cam.favorite;
    $("hint-default").textContent = cam.favorite ? "remove default" : "make default";
    renderHints(s, cam);
    const glyph = $("preview-glyph");
    let note = "";
    if (cam.type === "youtube" && !cam.video_id) note = cam.status === "offline" ? "Not live right now" : "Finding the live stream…";
    glyph.innerHTML = cam.type === "youtube" ? "" : cam.type === "windowswap" ? ICONS.window : ICONS.web;
    if (note) glyph.appendChild(el("span", "note", note));
    $("preview-media").className = cam.type;
    const live = $("preview-live");
    live.style.setProperty("--k", (live.clientWidth || 320) / 640); // the player is 640 wide, scaled to fit
    if (!(s.active && s.view === "globe")) {
      preview.stop();
      return;
    }
    preview.show({
      key: cam.id,
      videoId: cam.type === "youtube" ? cam.video_id : null,
      thumb: cam.thumb,
      live: s.prefs.preview !== "image",
    });
  }

  /** ▲ to the cams beside the globe (WindowSwap), ▼ back down or to the apps. */
  function renderHints(s, cam) {
    const sats = s.cams.filter((c) => c.lat == null);
    const placed = s.cams.length - sats.length;
    const up = cam.lat == null && placed > 0; // on a cam beside the globe
    $("hint-up").hidden = !sats.length || (up && sats.length < 2);
    $("hint-up-text").textContent = up ? "next" : sats.length ? sats[0].name : "";
    $("hint-down").hidden = !up && !(s.apps || []).length;
    $("hint-down-text").textContent = up ? "back to the globe" : "apps";
  }

  // ---------------------------------------------------------------- apps
  function renderApps(s) {
    const apps = s.apps || [];
    const key = JSON.stringify(apps.map((a) => [a.id, a.label, Boolean(a.icon)]));
    if (key !== appsKey) {
      appsKey = key;
      const grid = $("apps");
      grid.textContent = "";
      grid.style.setProperty("--cols", s.appColumns);
      for (const app of apps) {
        const tile = el("div", "app");
        tile.dataset.id = app.id;
        if (app.icon) tile.style.backgroundImage = `url("${app.icon}")`;
        if (app.icon && app.banner) tile.classList.add("has-banner"); // banners include the name
        tile.appendChild(el("span", "label", app.label));
        grid.appendChild(tile);
      }
    }

    const tiles = $("apps").children;
    for (let i = 0; i < tiles.length; i++) tiles[i].classList.toggle("focus", s.view === "apps" && i === s.appIndex);
    if (s.view === "apps" && tiles[s.appIndex]) tiles[s.appIndex].scrollIntoView({ block: "nearest" });
  }

  // -------------------------------------------------------------- render
  function render(s) {
    const prev = state;
    state = s;
    document.body.className = [`power-${s.power}`, `view-${s.view}`, s.active ? "active" : "inactive"].join(" ");
    renderMarkers(s);
    renderGlobe(s, prev);
    renderPreview(s);
    renderApps(s);
    $("site-text").textContent = s.site ? `Opening ${s.site.name}…` : "";
    const w = s.power === "on" && s.active ? s.waiting : null;
    $("status").hidden = !w;
    if (w) {
      $("status-text").textContent = "Waiting for the internet…";
      $("status-more").textContent = w.seconds >= 15
        ? `Check the box's network connection · Back to stop waiting`
        : `${w.name} opens as soon as it's back`;
    }
    $("admin-url").textContent = s.adminUrl ? `Manage cams: ${s.adminUrl.replace(/^https?:\/\//, "")}` : "";
    if (s.opening && (!prev || prev.opening !== s.opening)) {
      const cam = s.cams.find((c) => c.id === s.opening);
      if (cam) toast(`Finding ${cam.name}'s live stream…`);
    }
    if (s.power !== "on") $("toast").hidden = true;
  }

  function tickClock() {
    $("clock").textContent = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  tickClock();
  setInterval(tickClock, 10000);

  function toast(text) {
    const t = $("toast");
    t.textContent = text;
    t.hidden = false;
    clearTimeout(timers.toast);
    timers.toast = setTimeout(() => { t.hidden = true; }, 3000);
  }

  return {
    render,
    toast,
    globe,
    preview,
    /** Where the markers are on screen (for tests): {id: {x, y, visible}} */
    markers() {
      const out = {};
      for (const p of [...placed, ...sats]) out[p.cam.id] = { x: p.x, y: p.y, visible: !p.el.classList.contains("behind") };
      return out;
    },
  };
}
