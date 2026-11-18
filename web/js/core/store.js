// Persistent app state: cams, the default cam, preferences.
// Serialised to one JSON string that the platform saves (a file on Android,
// localStorage in a desktop browser).
import { DEFAULT_CAMS, DEFAULT_FAVORITE } from "./catalog.js";
import { parseSource } from "./youtube.js";
import { validZone } from "./daylight.js";

export const CAM_TYPES = ["youtube", "windowswap", "web"];
const CAM_FIELDS = ["name", "location", "type", "source", "match", "tz", "lat", "lon"];

export const DEFAULT_PREFS = {
  preview: "video", // the globe's preview card: "video" (a small live picture) | "image" (a still)
};

const clone = (x) => JSON.parse(JSON.stringify(x));

export function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "cam";
}

export class ValidationError extends Error {}

/** Validate and normalise a cam from the cam manager or the state file. */
export function cleanCam(data, existing = {}) {
  const cam = { ...existing };
  for (const f of CAM_FIELDS) if (f in data) cam[f] = data[f];
  const str = (v) => (v == null ? "" : String(v).trim());
  cam.name = str(cam.name) || "Untitled cam";
  cam.location = str(cam.location);
  cam.type = CAM_TYPES.includes(cam.type) ? cam.type : "youtube";
  cam.source = str(cam.source);
  cam.match = str(cam.match);
  cam.tz = str(cam.tz);
  for (const k of ["lat", "lon"]) {
    const v = cam[k];
    if (v === "" || v == null) cam[k] = null;
    else {
      cam[k] = Number(v);
      if (!Number.isFinite(cam[k])) throw new ValidationError(`${k === "lat" ? "latitude" : "longitude"} must be a number`);
    }
  }
  if (cam.lat != null && (cam.lat < -90 || cam.lat > 90)) throw new ValidationError("latitude must be between -90 and 90");
  if (cam.lon != null && (cam.lon < -180 || cam.lon > 180)) throw new ValidationError("longitude must be between -180 and 180");
  if (cam.tz && !validZone(cam.tz)) throw new ValidationError(`unknown time zone "${cam.tz}" (use e.g. America/New_York)`);
  if (cam.match) {
    try {
      new RegExp(cam.match, "i");
    } catch (e) {
      throw new ValidationError(`"title must contain" isn't a valid pattern: ${e.message}`);
    }
  }
  if (cam.type === "youtube" && !parseSource(cam.source)) {
    throw new ValidationError("a YouTube cam needs a video URL, video ID, @handle or channel URL");
  }
  if (cam.type === "web" && !/^https?:\/\//.test(cam.source)) throw new ValidationError("a web cam needs an http(s) URL");
  return cam;
}

export class Store {
  /**
   * @param {string|null} json saved state (null for first run)
   * @param {(json:string)=>void} persist called with the new state after each change
   */
  constructor(json, persist = () => {}) {
    this.persist = persist;
    this.data = Store.parse(json);
  }

  static parse(json) {
    let data = null;
    try {
      data = json ? JSON.parse(json) : null;
    } catch (e) {
      console.warn("state file unreadable, starting fresh", e);
    }
    if (!data || !Array.isArray(data.cams)) {
      data = { favorite: DEFAULT_FAVORITE, cams: clone(DEFAULT_CAMS), resolved: {} };
    }
    data.version = 3;
    // (version 2 had rewind settings; cams now play in the YouTube app)
    delete data.cam_settings;
    delete data.caps;
    data.resolved ||= {};
    const prefs = data.prefs || {};
    data.prefs = {};
    for (const k of Object.keys(DEFAULT_PREFS)) data.prefs[k] = k in prefs ? prefs[k] : DEFAULT_PREFS[k];
    data.keys ||= {};
    if (!("favorite" in data)) data.favorite = null;
    return data;
  }

  save() {
    this.persist(JSON.stringify(this.data));
  }

  // --- cams ----------------------------------------------------------------
  get cams() { return this.data.cams; }
  cam(id) { return this.cams.find((c) => c.id === id) || null; }
  indexOf(id) { return this.cams.findIndex((c) => c.id === id); }

  addCam(data) {
    const cam = cleanCam(data);
    const base = slugify(cam.name);
    let id = base;
    for (let n = 2; this.cam(id); n++) id = `${base}-${n}`;
    cam.id = id;
    this.cams.push(cam);
    this.save();
    return cam;
  }

  updateCam(id, data) {
    const cam = this.cam(id);
    if (!cam) return null;
    const updated = cleanCam(data, cam);
    if (updated.source !== cam.source || updated.match !== cam.match) {
      delete this.data.resolved[id];
    }
    Object.assign(cam, updated);
    this.save();
    return cam;
  }

  deleteCam(id) {
    this.data.cams = this.cams.filter((c) => c.id !== id);
    delete this.data.resolved[id];
    if (this.data.favorite === id) this.data.favorite = null;
    if (this.data.last === id) delete this.data.last;
    this.save();
  }

  moveCam(id, delta) {
    const i = this.indexOf(id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= this.cams.length) return;
    [this.cams[i], this.cams[j]] = [this.cams[j], this.cams[i]];
    this.save();
  }

  get favorite() {
    const f = this.data.favorite;
    return f && this.cam(f) ? f : null;
  }

  setFavorite(id) {
    this.data.favorite = id;
    this.save();
  }

  get last() {
    const l = this.data.last;
    return l && this.cam(l) ? l : null;
  }

  setLast(id) {
    if (this.data.last !== id) {
      this.data.last = id;
      this.save();
    }
  }

  // --- resolved YouTube IDs (a cache that survives restarts) -----------------
  resolved(id) {
    const e = this.data.resolved[id];
    return e ? e.video_id : null;
  }

  setResolved(id, videoId, when) {
    if (videoId) {
      this.data.resolved[id] = { video_id: videoId, at: when };
      this.save();
    }
  }

  // --- preferences and remote-button overrides --------------------------------
  get prefs() { return this.data.prefs; }

  setPrefs(changes) {
    const p = { ...this.data.prefs };
    if ("preview" in changes) {
      if (!["video", "image"].includes(changes.preview)) throw new ValidationError("preview must be video or image");
      p.preview = changes.preview;
    }
    this.data.prefs = p;
    this.save();
    return p;
  }

  get keys() { return this.data.keys; }

  setKey(key, action) {
    if (!/^KEYCODE_[A-Z0-9_]+$/.test(key)) throw new ValidationError("not an Android key name");
    if (action === null || action === undefined || action === "default") delete this.data.keys[key];
    else this.data.keys[key] = String(action);
    this.save();
  }
}
