// The preview card's picture: the cam's latest still straight away, then, once
// the selection has stayed put for a moment, a small muted live player. It
// stays hidden until it's really playing, so errors and loading never show.

const START_DELAY = 1200;
const PLAYER_W = 640; // rendered at 360p and scaled down, so YouTube sends a decent picture
const PLAYER_H = 360;

let apiPromise = null;
function loadYouTubeApi() {
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    if (window.YT && window.YT.Player) return resolve(window.YT);
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (prev) prev();
      resolve(window.YT);
    };
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    tag.onerror = () => {
      apiPromise = null;
      reject(new Error("YouTube API failed to load"));
    };
    document.head.appendChild(tag);
  });
  return apiPromise;
}

/**
 * @param {{still:HTMLElement, live:HTMLElement}} els
 */
export function createPreview({ still, live }) {
  let current = null; // {key, videoId, timer, player, dead}
  const failed = new Set(); // videos that can't be embedded: just the still for them

  function stop() {
    if (!current) return;
    const c = current;
    current = null;
    c.dead = true;
    clearTimeout(c.timer);
    try {
      if (c.player && c.player.destroy) c.player.destroy();
    } catch (e) { /* already gone */ }
    live.textContent = "";
    live.classList.remove("on");
  }

  function startPlayer(c) {
    loadYouTubeApi().then((YT) => {
      if (c.dead) return;
      // Build the iframe ourselves so it always sends a referrer: YouTube refuses
      // embeds without one ("Error 153"), which some WebView setups don't send.
      const frame = document.createElement("iframe");
      const params = new URLSearchParams({
        enablejsapi: "1", autoplay: "1", mute: "1", controls: "0", disablekb: "1", fs: "0",
        iv_load_policy: "3", rel: "0", playsinline: "1", origin: location.origin,
      });
      frame.src = `https://www.youtube.com/embed/${encodeURIComponent(c.videoId)}?${params}`;
      frame.width = PLAYER_W;
      frame.height = PLAYER_H;
      frame.allow = "autoplay; encrypted-media";
      frame.referrerPolicy = "strict-origin-when-cross-origin";
      frame.tabIndex = -1;
      live.appendChild(frame);
      c.player = new YT.Player(frame, {
        events: {
          onReady: () => {
            if (c.dead) return;
            c.player.mute();
            c.player.playVideo();
          },
          onStateChange: (e) => {
            if (!c.dead && e.data === 1) live.classList.add("on");
          },
          onError: (e) => {
            if (c.dead) return;
            console.info(`no live preview for ${c.videoId} (YouTube error ${e.data})`);
            if (e.data === 101 || e.data === 150 || e.data === 153) failed.add(c.videoId);
            stop();
          },
        },
      });
    }).catch((err) => {
      if (!c.dead) console.info(`no live preview: ${err.message}`);
    });
  }

  return {
    /**
     * Show a cam. `key` identifies what's shown (same key: nothing changes).
     * @param {{key:string, videoId?:string|null, thumb?:string|null, live?:boolean}} o
     */
    show({ key, videoId = null, thumb = null, live: wantLive = true }) {
      const epoch = Math.floor(Date.now() / 600000); // YouTube refreshes live stills every few minutes
      const stillUrl = thumb ? `url("${thumb}?t=${epoch}")` : "";
      if (still.style.backgroundImage !== stillUrl) still.style.backgroundImage = stillUrl;
      const fullKey = `${key}|${videoId}|${wantLive}`;
      if (current && current.key === fullKey) return;
      stop();
      if (!videoId || !wantLive || failed.has(videoId)) {
        current = { key: fullKey, dead: false };
        return;
      }
      const c = { key: fullKey, videoId, dead: false };
      c.timer = setTimeout(() => startPlayer(c), START_DELAY);
      current = c;
    },
    stop,
    get playing() { return Boolean(current && current.player && live.classList.contains("on")); },
  };
}
