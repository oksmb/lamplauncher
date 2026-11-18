// Work out which YouTube video a cam should play.
//
// 24/7 cams get a new video ID whenever the stream restarts, so a cam can point at
// a channel instead; this finds the channel's current live stream by reading its
// public pages (no API key). Pages are fetched through the app's /proxy endpoint
// because the browser can't read youtube.com pages directly.

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/** A video ID, any YouTube video URL, a @handle or a channel URL -> {kind, value} | null */
export function parseSource(text) {
  text = (text || "").trim();
  if (!text) return null;
  if (VIDEO_ID.test(text)) return { kind: "video", value: text };
  if (text.startsWith("@")) return { kind: "channel", value: `https://www.youtube.com/${text}` };
  if (!text.includes("://")) text = "https://" + text;
  let url;
  try {
    url = new URL(text);
  } catch (e) {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^(www\.|m\.)/, "");
  const parts = url.pathname.split("/").filter(Boolean);
  if (host === "youtu.be" && parts[0] && VIDEO_ID.test(parts[0])) return { kind: "video", value: parts[0] };
  if (!["youtube.com", "youtube-nocookie.com", "music.youtube.com"].includes(host)) return null;
  const v = url.searchParams.get("v");
  if (v && VIDEO_ID.test(v)) return { kind: "video", value: v };
  if (parts.length >= 2 && ["live", "embed", "shorts", "v"].includes(parts[0]) && VIDEO_ID.test(parts[1])) {
    return { kind: "video", value: parts[1] };
  }
  if (parts[0] && parts[0].startsWith("@")) return { kind: "channel", value: `https://www.youtube.com/${parts[0]}` };
  if (parts.length >= 2 && ["channel", "c", "user"].includes(parts[0])) {
    return { kind: "channel", value: `https://www.youtube.com/${parts[0]}/${parts[1]}` };
  }
  return null;
}

const CANONICAL = /<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([A-Za-z0-9_-]{11})"/;

/** The video ID from a channel's /live page, if the channel is live now. */
export function parseLivePage(html) {
  const m = CANONICAL.exec(html);
  if (!m) return null;
  // /live also points at upcoming streams; require "live now"
  if (html.includes('"isLiveNow":true') || html.includes('"isLive":true') || html.includes("LIVE_NOW")) return m[1];
  if (html.includes('"isUpcoming":true')) return null;
  return m[1];
}

/** Find the end of the JSON object starting at `start` (string/escape aware). */
function jsonEnd(text, start) {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

export function extractInitialData(html) {
  const marker = /(?:var ytInitialData|window\["ytInitialData"\])\s*=\s*/.exec(html);
  if (!marker) return null;
  const start = marker.index + marker[0].length;
  if (html[start] !== "{") return null;
  const end = jsonEnd(html, start);
  if (end < 0) return null;
  try {
    return JSON.parse(html.slice(start, end));
  } catch (e) {
    return null;
  }
}

function text(node) {
  if (typeof node === "string") return node;
  if (node && typeof node === "object") {
    if ("simpleText" in node) return node.simpleText;
    if (Array.isArray(node.runs)) return node.runs.map((r) => r.text || "").join("");
    if (typeof node.content === "string") return node.content;
  }
  return "";
}

function isLive(node) {
  const blob = JSON.stringify(node);
  return blob.includes('"style":"LIVE"') || blob.includes("BADGE_STYLE_TYPE_LIVE_NOW") ||
    blob.includes("THUMBNAIL_OVERLAY_BADGE_STYLE_LIVE") || blob.includes('"text":"LIVE"');
}

/** All videos in a ytInitialData tree, in page order: [{id, title, live}]. */
export function findVideos(data) {
  const found = [];
  const seen = new Set();
  const add = (id, title, node) => {
    if (seen.has(id)) return;
    seen.add(id);
    found.push({ id, title, live: isLive(node) });
  };
  const walk = (node) => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!node || typeof node !== "object") return;
    const r = node.videoRenderer || node.gridVideoRenderer;
    if (r && typeof r === "object" && VIDEO_ID.test(String(r.videoId || ""))) {
      add(r.videoId, text(r.title), r);
      return;
    }
    const l = node.lockupViewModel;
    if (l && typeof l === "object" && VIDEO_ID.test(String(l.contentId || ""))) {
      const meta = (l.metadata || {}).lockupMetadataViewModel || {};
      add(l.contentId, text(meta.title), l);
      return;
    }
    Object.values(node).forEach(walk);
  };
  walk(data);
  return found;
}

export function pickStream(videos, pattern) {
  let regex = null;
  if (pattern) {
    try {
      regex = new RegExp(pattern, "i");
    } catch (e) {
      return null;
    }
  }
  const matches = (v) => !regex || regex.test(v.title);
  const live = videos.find((v) => v.live && matches(v));
  if (live) return live.id;
  // nothing marked live: the page layout may have changed, use a title match
  const any = videos.find(matches);
  return any ? any.id : null;
}

export function thumbnail(videoId) {
  return videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault_live.jpg` : null;
}

/** Resolves sources to video IDs; `fetchText(url)` returns a page's HTML (throws on failure). */
export class Resolver {
  constructor(fetchText, { cacheMs = 60000, now = () => Date.now() } = {}) {
    this.fetchText = fetchText;
    this.cacheMs = cacheMs;
    this.now = now;
    this.cache = new Map(); // url -> {at, promise}
  }

  get(url) {
    const hit = this.cache.get(url);
    if (hit && this.now() - hit.at < this.cacheMs) return hit.promise;
    const promise = this.fetchText(url);
    this.cache.set(url, { at: this.now(), promise });
    promise.catch(() => this.cache.delete(url));
    return promise;
  }

  async resolve(sourceText, match = "") {
    const source = parseSource(sourceText);
    if (!source) return null;
    if (source.kind === "video") return source.value;
    if (!match) {
      try {
        const vid = parseLivePage(await this.get(source.value + "/live"));
        if (vid) return vid;
      } catch (e) {
        console.warn(`resolving ${source.value}/live failed: ${e.message || e}`);
      }
    }
    let data;
    try {
      data = extractInitialData(await this.get(source.value + "/streams"));
    } catch (e) {
      console.warn(`resolving ${source.value}/streams failed: ${e.message || e}`);
      return null;
    }
    return pickStream(findVideos(data || {}), match);
  }
}
