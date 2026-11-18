// The LampLauncher state machine: what each remote button does on each screen.
//
// Screens: standby (TV off); the globe (each cam a dot, ◀ ▶ spins to the next one,
// with a small live preview of it); the apps list (▼ from the globe); and
// WindowSwap (or another web cam page) full screen. YouTube cams play in the
// box's own YouTube app, which picks the best quality for the TV; Home there
// comes back to the globe. The page only draws snapshots of this state, so the
// remote, the phone cam manager and the tests all behave the same.
//
// Power: the box's power button switches the box and (over HDMI-CEC) the TV.
// LampLauncher follows the screen: when it comes on, the default (★) cam opens.
import { actionFor, isKnownKey, ACTIONS } from "./keys.js";
import * as day from "./daylight.js";
import { globeOrder } from "./geo.js";
import { sunElevation } from "./sun.js";
import { parseSource, thumbnail } from "./youtube.js";
import { WINDOWSWAP_URL } from "./catalog.js";
import { ValidationError } from "./store.js";

const REFRESH_EVERY = 30 * 60 * 1000; // look up channel cams' current streams again
const TICK_EVERY = 30 * 1000; // the clocks and the line between day and night move
// A Home press or LampLauncher coming to the front this soon after the screen came
// on is part of waking up, not the user asking for the globe.
const WAKE_GRACE = 15 * 1000;
// OK on a channel cam waits this long for its current stream, then uses the last one known.
const RESOLVE_WAIT = 6000;
// Before opening a cam, YouTube must be reachable (after waking up the box's network can
// take a while, and the YouTube app shows an error rather than waiting). A successful
// check is trusted this long; waking up always checks again.
const NET_OK_FOR = 2 * 60 * 1000;
const NET_RETRY_MAX = 5000;
export const APP_COLUMNS = 5;

export class Controller {
  /**
   * @param {object} o
   * @param {import("./store.js").Store} o.store
   * @param {{resolve(source:string, match:string):Promise<string|null>}} o.resolver
   * @param {object} o.platform  openYouTube(url)/showSite(url)/hideSite()/siteEval(js)/
   *   setKeepScreenOn(on)/launchApp(id)/wakeScreen()/online() (a promise: can YouTube be reached?)
   */
  constructor({ store, resolver, platform, now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
    this.store = store;
    this.resolver = resolver;
    this.platform = platform;
    this.now = now;
    this.sleepFor = sleep;

    this.power = "standby";
    this.view = "globe"; // "globe" | "apps" | "site"
    this.selected = null; // the cam picked on the globe
    this.globeCam = null; // the last cam picked on the globe itself (▼ from WindowSwap returns to it)
    this.appIndex = 0;
    this.site = null; // {cam, url}: a web page cam shown full screen
    this.opening = null; // a channel cam waiting for its current stream before it opens
    this.waiting = null; // {cam, since}: a cam waiting for the internet before it opens
    this.onlineAt = 0; // when YouTube was last found reachable
    this.status = {}; // cam id -> "ok" | "offline" | "stale" | "resolving"
    this.suspended = false; // another app (or the screensaver) is in front of LampLauncher
    this.wokeAt = 0;
    this.pendingWake = false;
    this.lastInput = now();
    this.lastRefresh = 0;
    this.token = 0;
    this.resolving = new Map();
    this.apps = [];
    this.info = {};
    this.lastUnknownKey = null;
    this.listeners = new Set();
    this._keepScreenOn = null;
    this._siteUrl = null;
    this._timer = null;
  }

  // ------------------------------------------------------------------ plumbing
  subscribe(fn) {
    this.listeners.add(fn);
    fn(this.snapshot());
    return () => this.listeners.delete(fn);
  }

  emit(msg) {
    for (const fn of this.listeners) {
      try {
        fn(msg);
      } catch (e) {
        console.error(e);
      }
    }
  }

  render() {
    this.emit(this.snapshot());
  }

  toast(text) {
    this.emit({ type: "toast", text });
  }

  start() {
    if (!this._timer) this._timer = setInterval(() => this.tick(), TICK_EVERY);
    this.refreshAll();
  }

  stop() {
    clearInterval(this._timer);
    this._timer = null;
  }

  setApps(apps) {
    this.apps = Array.isArray(apps) ? apps : [];
    this.appIndex = Math.max(0, Math.min(this.appIndex, this.apps.length - 1));
    if (this.view === "apps" && !this.apps.length) this.view = "globe";
    this.render();
  }

  setInfo(info) {
    this.info = info || {};
    this.render();
  }

  tick() {
    if (this.power !== "on") return;
    if (this.now() - this.lastRefresh > REFRESH_EVERY) this.refreshAll();
    if (!this.suspended) this.render();
  }

  // --------------------------------------------------------------- inputs
  /** A remote button, by Android key name. */
  key(name, opts = {}) {
    const action = actionFor(name, opts, this.store.keys);
    if (!action) {
      if (!isKnownKey(name, this.store.keys) && !opts.repeat) this.lastUnknownKey = { key: name, at: this.now() };
      return null;
    }
    this.action(action);
    return action;
  }

  action(name) {
    if (!ACTIONS.includes(name)) return;
    this.lastInput = this.now();
    if ((this.opening || this.waiting) && name !== "ok") this.cancelOpening(); // any other button: stop waiting
    if (this.power !== "on") {
      // the box's power button never reaches apps; "power" here is the cam manager's button
      this.wake({ wakeScreen: name === "power", openDefault: name === "power" });
    } else if (name === "power") {
      this.sleep();
    } else if (this.view === "site") {
      this.siteKey(name);
    } else if (this.view === "apps") {
      this.appsKey(name);
    } else {
      this.globeKey(name);
    }
    this.sync();
    this.render();
  }

  /**
   * Where LampLauncher stands when the page starts.
   * @param {{screenOn?:boolean, foreground?:boolean, wake?:boolean}} o
   *   wake: the screen came on (or the box started) since LampLauncher last ran, so
   *   the default cam should open; otherwise Android just restarted LampLauncher
   *   (e.g. Home after it was closed to save memory) and the globe shows.
   */
  boot({ screenOn = true, foreground = true, wake = true } = {}) {
    if (!screenOn) return; // standby until the screen comes on
    this.suspended = !foreground;
    if (wake) {
      this.lifecycle("screen_on");
    } else {
      this.power = "on";
      this.toGlobe({ fresh: true });
      this.sync();
      this.render();
    }
  }

  /** Android lifecycle: screen_on, screen_off, start, stop, home_intent. */
  lifecycle(ev) {
    const now = this.now();
    switch (ev) {
      case "screen_on":
        // Android may bring LampLauncher to the front just before reporting the
        // screen on; don't open the default cam twice
        if (this.power === "on" && now - this.wokeAt < WAKE_GRACE) break;
        this.wokeAt = now;
        if (this.suspended) {
          // another app is in front: leave it. If the box brings LampLauncher to the
          // front as part of waking up (Google TV boxes do), "start" opens the default cam.
          this.power = "on";
          this.toGlobe({ fresh: true });
          this.pendingWake = true;
        } else {
          this.wake();
        }
        break;
      case "screen_off":
        this.pendingWake = false;
        this.sleep();
        break;
      case "stop":
        this.suspended = true;
        break;
      case "start":
        this.suspended = false;
        if (this.pendingWake) {
          this.pendingWake = false;
          if (now - this.wokeAt < WAKE_GRACE) this.wake();
          // (much later: someone came back from another app; the globe it is)
        } else if (this.power !== "on") {
          this.wake();
        }
        break;
      case "home_intent":
        // Home: back to the globe, except as part of waking up
        if (this.power !== "on") this.wake();
        else if (now - this.wokeAt >= WAKE_GRACE) {
          this.lastInput = now;
          this.toGlobe();
        }
        break;
      default:
        return;
    }
    this.sync();
    this.render();
  }

  // ----------------------------------------------------------------- power
  wake({ wakeScreen = false, openDefault = true } = {}) {
    console.info("waking up");
    this.power = "on";
    this.wokeAt = this.now();
    this.lastInput = this.now();
    if (wakeScreen) this.platform.wakeScreen?.();
    this.onlineAt = 0; // the network may still be waking up too
    this.toGlobe({ fresh: true });
    const fav = this.store.favorite;
    if (openDefault && fav) this.open(fav, { auto: true });
    this.refreshAll();
    this.sync();
  }

  sleep() {
    console.info("going to standby");
    this.power = "standby";
    this.cancelOpening();
    this.view = "globe";
    this.site = null;
    this.sync();
  }

  /** Point the site view and the screen-on flag at the current state. */
  sync() {
    const active = this.power === "on" && !this.suspended;
    const site = active && this.view === "site" && this.site ? this.site.url : null;
    if (site !== this._siteUrl) {
      this._siteUrl = site;
      if (site) this.platform.showSite(site);
      else this.platform.hideSite();
    }
    // keep the TV on while WindowSwap plays; on the globe the box's own
    // screensaver and sleep timer do their thing (the YouTube app handles its own)
    const keep = Boolean(site);
    if (keep !== this._keepScreenOn) {
      this._keepScreenOn = keep;
      this.platform.setKeepScreenOn(keep);
    }
  }

  // ----------------------------------------------------------------- globe
  /** Every cam: west to east around the globe, then the ones beside it (like WindowSwap). */
  order() {
    return globeOrder(this.store.cams);
  }

  /** The cams on the globe, west to east: ◀ ▶ go round these. */
  placedOrder() {
    return globeOrder(this.store.cams.filter((c) => day.onGlobe(c)));
  }

  /** The cams beside the globe (no place on it): ▲ goes up to these. */
  satellites() {
    return this.store.cams.filter((c) => !day.onGlobe(c)).map((c) => c.id);
  }

  /** The cam where the sun is highest right now (null if no cam has a place). */
  sunniest() {
    const now = new Date(this.now());
    let best = null;
    let highest = -Infinity;
    for (const c of this.store.cams) {
      if (!day.onGlobe(c)) continue;
      const e = sunElevation(c.lat, c.lon, now);
      if (e > highest) {
        highest = e;
        best = c.id;
      }
    }
    return best;
  }

  /** The cam the globe starts on: the default cam if it's light there, otherwise the one where the sun is highest. */
  initialSelection() {
    const fav = this.store.cam(this.store.favorite);
    if (fav && day.light(fav, new Date(this.now())) !== "night") return fav.id;
    return this.sunniest() || (this.store.cams[0] ? this.store.cams[0].id : null);
  }

  /** Show the globe. `fresh`: start over from the sunlit side rather than the last cam picked. */
  toGlobe({ fresh = false } = {}) {
    this.view = "globe";
    this.site = null;
    if (fresh || !this.store.cam(this.selected)) this.selected = this.initialSelection();
    this.sync();
  }

  /**
   * ◀ ▶ spin round the cams on the globe; ▲ goes up to the cams beside it
   * (WindowSwap), ▼ back down to the globe where you were, or to the apps.
   */
  globeKey(action) {
    if (!this.store.cam(this.selected)) this.selected = this.initialSelection();
    const placed = this.placedOrder();
    const sats = this.satellites();
    const up = sats.includes(this.selected) && placed.length > 0; // on a cam beside the globe
    // the cam on the globe we were on (to come back to from up there)
    const below = () => (placed.includes(this.globeCam) ? this.globeCam : this.sunniest());
    if (!up && placed.includes(this.selected)) this.globeCam = this.selected;
    if (action === "left" || action === "right" || action === "next") {
      const ring = placed.length ? placed : sats;
      if (!ring.length) return;
      const from = up ? below() : this.selected;
      const i = ring.indexOf(from);
      const step = action === "left" ? -1 : 1;
      this.selected = i < 0 ? ring[0] : ring[(i + step + ring.length) % ring.length];
    } else if (action === "up") {
      if (!sats.length) return;
      const i = sats.indexOf(this.selected);
      this.selected = sats[(i + 1) % sats.length]; // (several: ▲ again for the next)
    } else if (action === "down") {
      if (up) this.selected = below();
      else if (this.apps.length) this.view = "apps";
    } else if (action === "ok") {
      if (this.selected) this.open(this.selected);
    } else if (action === "menu") {
      if (this.selected) this.toggleDefault(this.selected);
    }
  }

  /** Hold OK: this cam opens when the TV is turned on (hold again to have none). */
  toggleDefault(camId) {
    const cam = this.store.cam(camId);
    if (!cam) return;
    if (this.store.favorite === camId) {
      this.store.setFavorite(null);
      this.toast(`${cam.name} is no longer the default cam`);
    } else {
      this.store.setFavorite(camId);
      this.toast(`★ ${cam.name} now opens when you turn on the TV`);
    }
  }

  // ------------------------------------------------------------------ apps
  appsKey(action) {
    const n = this.apps.length;
    const cols = APP_COLUMNS;
    let i = Math.max(0, Math.min(this.appIndex, n - 1));
    if (action === "left" && i % cols) i--;
    else if (action === "right" && i % cols < cols - 1 && i + 1 < n) i++;
    else if (action === "down" && i + cols < n) i += cols;
    else if (action === "down" && Math.floor(i / cols) < Math.floor((n - 1) / cols)) i = n - 1; // short last row
    else if (action === "up" && i >= cols) i -= cols;
    else if (action === "up" || action === "back" || action === "home") this.view = "globe";
    else if (action === "ok" && this.apps[i]) this.launchApp(this.apps[i]);
    this.appIndex = i;
  }

  launchApp(app) {
    this.toast(`Opening ${app.label}…`);
    this.platform.launchApp(app.id);
  }

  // -------------------------------------------------------------- web cams
  siteKey(action) {
    if (action === "back" || action === "home") this.toGlobe();
    else if (action === "ok" || action === "right" || action === "next") this.siteNext();
    else if (action === "menu" && this.site) this.toggleDefault(this.site.cam);
  }

  siteNext() {
    // reloading WindowSwap's player page opens another random window
    this.platform.siteEval("location.reload()");
    this.toast("Opening another window…");
  }

  // -------------------------------------------------------------- opening cams
  /**
   * Open a cam: YouTube cams in the YouTube app, web cams full screen here.
   * `auto`: opened by waking up, so the globe keeps its sunlit starting point.
   */
  async open(camId, { auto = false } = {}) {
    const cam = this.store.cam(camId);
    if (!cam) return;
    if (!auto) this.selected = camId;
    this.store.setLast(camId);
    const token = ++this.token;
    this.opening = null;
    this.waiting = null;
    if (!(await this.waitForNetwork(camId, token))) return;
    if (cam.type !== "youtube") {
      this.site = { cam: camId, url: cam.type === "web" ? cam.source : WINDOWSWAP_URL };
      this.view = "site";
      this._siteUrl = null; // (re)load the page even if it's the same site
      this.sync();
      this.render();
      return;
    }
    this.view = "globe";
    this.site = null;
    const source = parseSource(cam.source);
    if (!source) return;
    let videoId = source.kind === "video" ? source.value : null;
    if (!videoId) {
      // a channel: find the stream it's showing now
      this.opening = camId;
      this.render();
      const found = await Promise.race([this.resolve(camId), this.sleepFor(RESOLVE_WAIT).then(() => null)]);
      if (token !== this.token) return; // something else happened meanwhile
      this.opening = null;
      videoId = found || this.store.resolved(camId);
    }
    if (this.power !== "on") return;
    let url;
    if (videoId) {
      url = `https://www.youtube.com/watch?v=${videoId}`;
    } else {
      url = `${source.value}/live`;
      this.toast(`Couldn't find ${cam.name}'s live stream; trying its channel`);
    }
    console.info(`opening ${camId} in the YouTube app: ${url}`);
    if (videoId) this.toast(`Opening ${cam.name}\u2026`);
    this.platform.openYouTube(url);
    this.render();
  }

  cancelOpening() {
    this.token += 1;
    this.opening = null;
    if (this.waiting) {
      this.waiting = null;
      this.render();
    }
  }

  /**
   * Waits until YouTube can be reached, checking again every few seconds, with a
   * message on the globe while it waits. False if something else happened meanwhile
   * (another button, the TV turned off), and the cam shouldn't open.
   */
  async waitForNetwork(camId, token) {
    if (!this.platform.online || this.now() - this.onlineAt < NET_OK_FOR) return true;
    const since = this.now();
    for (let tries = 1; ; tries++) {
      let ok = false;
      try {
        ok = await this.platform.online();
      } catch (e) {
        ok = false;
      }
      if (token !== this.token || this.power !== "on") return false;
      if (ok) {
        this.onlineAt = this.now();
        if (this.waiting) {
          console.info(`the network is up after ${Math.round((this.now() - since) / 1000)}s`);
          this.waiting = null;
          this.refreshAll(); // lookups made while offline failed
        }
        return true;
      }
      if (!this.waiting) console.info(`can't reach YouTube yet; waiting to open ${camId}`);
      this.waiting = { cam: camId, since };
      this.render();
      await this.sleepFor(Math.min(NET_RETRY_MAX, 1000 * tries));
      if (token !== this.token || this.power !== "on") return false;
    }
  }

  // ------------------------------------------------------------ resolution
  async refreshAll() {
    this.lastRefresh = this.now();
    for (const cam of [...this.store.cams]) {
      if (cam.type === "youtube") await this.resolve(cam.id);
    }
  }

  /** Find a cam's current video; concurrent calls share one lookup. */
  resolve(camId) {
    let task = this.resolving.get(camId);
    if (!task) {
      task = this._resolve(camId).finally(() => this.resolving.delete(camId));
      this.resolving.set(camId, task);
    }
    return task;
  }

  async _resolve(camId) {
    const cam = this.store.cam(camId);
    if (!cam || cam.type !== "youtube") return null;
    if (!this.status[camId]) this.status[camId] = "resolving";
    let vid = null;
    try {
      vid = await this.resolver.resolve(cam.source, cam.match || "");
    } catch (e) {
      console.warn(`resolving ${camId} failed`, e);
    }
    if (vid) {
      this.status[camId] = "ok";
      if (vid !== this.store.resolved(camId)) {
        console.info(`${camId} is now video ${vid}`);
        this.store.setResolved(camId, vid, this.now());
      }
    } else {
      this.status[camId] = this.store.resolved(camId) ? "stale" : "offline";
    }
    this.render();
    return vid;
  }

  // --------------------------------------------------------------- snapshot
  camView(cam, now) {
    const source = cam.type === "youtube" ? parseSource(cam.source) : null;
    const vid = source ? (source.kind === "video" ? source.value : this.store.resolved(cam.id)) : null;
    const sun = day.sunState(cam, now);
    const placed = day.onGlobe(cam);
    return {
      id: cam.id,
      name: cam.name,
      location: cam.location || "",
      type: cam.type,
      lat: placed ? cam.lat : null,
      lon: placed ? cam.lon : null,
      favorite: cam.id === this.store.favorite,
      light: sun.light,
      sun: sun.icon ? `${sun.icon} ${sun.text}` : "",
      clock: day.camClock(cam, now),
      video_id: vid,
      thumb: thumbnail(vid),
      status: cam.type !== "youtube" ? "ok" : this.status[cam.id] || (vid ? "ok" : "resolving"),
    };
  }

  snapshot() {
    const now = new Date(this.now());
    const byId = new Map(this.store.cams.map((c) => [c.id, c]));
    const site = this.site && byId.get(this.site.cam);
    return {
      type: "state",
      now: now.getTime(),
      power: this.power,
      active: this.power === "on" && !this.suspended,
      view: this.view,
      selected: byId.has(this.selected) ? this.selected : null,
      opening: this.opening,
      waiting: this.waiting && byId.has(this.waiting.cam)
        ? { cam: this.waiting.cam, name: byId.get(this.waiting.cam).name, seconds: Math.round((now - this.waiting.since) / 1000) }
        : null,
      cams: this.order().map((id) => this.camView(byId.get(id), now)),
      apps: this.apps,
      appIndex: this.appIndex,
      appColumns: APP_COLUMNS,
      site: this.site ? { ...this.site, name: site ? site.name : "", type: site ? site.type : "" } : null,
      prefs: { preview: this.store.prefs.preview },
      adminUrl: this.info.adminUrl || null,
    };
  }

  // ------------------------------------------------------------ cam manager API
  /** Handles the phone cam manager's requests. Returns {status, body}. */
  async api(method, path, body = {}) {
    try {
      return await this._api(method, path.split("?")[0], body || {});
    } catch (e) {
      if (e instanceof ValidationError) return { status: 400, body: { error: e.message } };
      console.error(e);
      return { status: 500, body: { error: String(e.message || e) } };
    }
  }

  async _api(method, path, body) {
    const store = this.store;
    const ok = (b) => ({ status: 200, body: b });
    let m;
    if (method === "GET" && path === "/api/state") return ok(this.snapshot());
    if (method === "POST" && (m = path.match(/^\/api\/action\/(\w+)$/))) {
      if (!ACTIONS.includes(m[1])) return { status: 400, body: { error: `unknown action; use one of ${ACTIONS.join(", ")}` } };
      this.action(m[1]);
      return ok({ ok: true, power: this.power, view: this.view });
    }
    if (method === "GET" && path === "/api/cams") {
      const resolved = {};
      for (const c of store.cams) resolved[c.id] = store.resolved(c.id);
      return ok({ cams: store.cams, favorite: store.favorite, resolved, status: this.status });
    }
    if (method === "POST" && path === "/api/cams") {
      const cam = store.addCam(body);
      if (cam.type === "youtube") this.resolve(cam.id);
      this.render();
      return ok(cam);
    }
    if (method === "POST" && path === "/api/check") {
      const source = parseSource(body.source || "");
      if (!source) return ok({ ok: false, error: "Not a YouTube video, @handle or channel URL" });
      const vid = await this.resolver.resolve(body.source, body.match || "");
      return ok({ ok: Boolean(vid), kind: source.kind, video_id: vid,
        error: vid ? null : "No live stream found on that channel right now" });
    }
    if ((m = path.match(/^\/api\/cams\/([\w-]+)(?:\/(\w+))?$/))) {
      const [, id, verb] = m;
      if (!store.cam(id)) return { status: 404, body: { error: "no such cam" } };
      if (method === "PUT" && !verb) {
        const cam = store.updateCam(id, body);
        if (cam.type === "youtube") this.resolve(id);
        if (this.site && this.site.cam === id) this.open(id);
        this.render();
        return ok(cam);
      }
      if (method === "DELETE" && !verb) {
        if (this.site && this.site.cam === id) this.toGlobe();
        store.deleteCam(id);
        if (this.selected === id) this.selected = this.initialSelection();
        this.sync();
        this.render();
        return ok({ ok: true });
      }
      if (method === "POST" && verb === "move") {
        store.moveCam(id, Number(body.delta) || 0);
        this.render();
        return ok({ ok: true });
      }
      if (method === "POST" && verb === "favorite") {
        store.setFavorite(store.favorite === id ? null : id);
        this.render();
        return ok({ favorite: store.favorite });
      }
      if (method === "POST" && verb === "play") {
        this.lastInput = this.now();
        if (this.power !== "on") this.wake({ wakeScreen: true, openDefault: false });
        this.open(id);
        this.render();
        return ok({ ok: true });
      }
    }
    if (method === "GET" && path === "/api/prefs") {
      return ok({ prefs: store.prefs, keys: store.keys, lastUnknownKey: this.lastUnknownKey, info: this.info, actions: ACTIONS });
    }
    if (method === "PUT" && path === "/api/prefs") {
      const prefs = store.setPrefs(body.prefs || {});
      for (const [key, action] of Object.entries(body.keys || {})) {
        if (action && action !== "default" && !ACTIONS.includes(action) && action !== "none") {
          throw new ValidationError(`unknown action "${action}"`);
        }
        store.setKey(key, action === "none" ? "" : action);
      }
      this.render();
      return ok({ prefs, keys: store.keys });
    }
    return { status: 404, body: { error: "not found" } };
  }
}
