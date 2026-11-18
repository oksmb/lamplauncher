// The device LampLauncher runs on.
//
// On the Onn/Google TV box the Android app loads this page with ?platform=android
// and hands it a MessagePort (only this page's origin can receive it). Everything
// device-specific goes over that port: saving state, keeping the screen on,
// opening a cam in the YouTube app, showing WindowSwap full screen, launching
// other apps, and in the other direction remote buttons, screen on/off and the
// phone cam manager's requests.
//
// In a desktop browser (development and tests) a stand-in does the same with
// localStorage, an iframe and the dev server (tools/devserver.mjs).
//
// Interface used by main.js / the controller:
//   initialState, apps, info, boot ({screenOn, foreground, wake}: see Controller.boot)
//   saveState(json) setKeepScreenOn(on) openYouTube(url) showSite(url) hideSite()
//   siteEval(js) launchApp(id) wakeScreen() online() apiReply(id, result) ready()
//   callbacks set by main.js: onKey(key, {repeat, long}) onLifecycle(ev) onToast(text)
//                             onApi(id, method, path, body) onApps(apps) onInfo(info)

/**
 * Can YouTube be reached right now? Asks youtube.com for its tiny "no content"
 * page (the one Chrome and YouTube use to check a connection). Any answer means
 * the network is up; no answer within a few seconds means it isn't (yet).
 */
export async function canReachYouTube(timeoutMs = 4000) {
  if (navigator.onLine === false) return false; // no network at all
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    await fetch(`https://www.youtube.com/generate_204?t=${Date.now()}`, { mode: "no-cors", cache: "no-store", signal: abort.signal });
    return true;
  } catch (e) {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export function connectPlatform() {
  const params = new URLSearchParams(location.search);
  return params.get("platform") === "android" ? androidPlatform() : devPlatform(params);
}

// --------------------------------------------------------------- Android
function androidPlatform() {
  return new Promise((resolve) => {
    let port = null;
    const p = {
      name: "android",
      initialState: null,
      apps: [],
      info: {},
      send(msg) { if (port) port.postMessage(JSON.stringify(msg)); },
      saveState(json) { p.send({ t: "save", data: json }); },
      setKeepScreenOn(on) { p.send({ t: "keepScreenOn", on }); },
      openYouTube(url) { p.send({ t: "youtube", url }); },
      showSite(url) { p.send({ t: "site", url }); },
      hideSite() { p.send({ t: "site", url: null }); },
      siteEval(js) { p.send({ t: "siteEval", js }); },
      launchApp(id) { p.send({ t: "launch", id }); },
      wakeScreen() { p.send({ t: "wakeScreen" }); },
      online: () => canReachYouTube(),
      apiReply(id, result) { p.send({ t: "apiReply", id, status: result.status, body: JSON.stringify(result.body) }); },
      ready() { p.send({ t: "ready" }); },
    };
    const onPort = (e) => {
      if (e.data !== "lamplauncher-port" || !e.ports || !e.ports[0]) return;
      if (port) port.close();
      port = e.ports[0];
      port.onmessage = (ev) => {
        let m;
        try {
          m = JSON.parse(ev.data);
        } catch (err) {
          return;
        }
        if (m.t === "init") {
          p.initialState = m.state || null;
          p.apps = m.apps || [];
          p.info = m.info || {};
          p.boot = { screenOn: Boolean(m.interactive), foreground: Boolean(m.foreground), wake: m.wake !== false };
          resolve(p);
        } else if (m.t === "key") p.onKey?.(m.key, { repeat: m.repeat || 0, long: Boolean(m.long) });
        else if (m.t === "life") p.onLifecycle?.(m.ev);
        else if (m.t === "api") {
          let body = {};
          try {
            body = m.body ? JSON.parse(m.body) : {};
          } catch (err) {
            p.apiReply(m.id, { status: 400, body: { error: "expected a JSON body" } });
            return;
          }
          p.onApi?.(m.id, m.method, m.path, body);
        }
        else if (m.t === "apps") p.onApps?.(m.apps || []);
        else if (m.t === "info") p.onInfo?.(m.info || {});
        else if (m.t === "toast") p.onToast?.(m.text || "");
      };
      p.send({ t: "hello" });
    };
    window.addEventListener("message", onPort);
    // route console output to logcat as well
    for (const level of ["log", "info", "warn", "error"]) {
      const orig = console[level].bind(console);
      console[level] = (...args) => {
        orig(...args);
        p.send({ t: "log", level, msg: args.map((a) => (a instanceof Error ? a.stack : typeof a === "string" ? a : JSON.stringify(a))).join(" ") });
      };
    }
  });
}

// --------------------------------------------------------------- desktop stand-in
const DEV_KEYS = {
  ArrowUp: "KEYCODE_DPAD_UP", ArrowDown: "KEYCODE_DPAD_DOWN", ArrowLeft: "KEYCODE_DPAD_LEFT",
  ArrowRight: "KEYCODE_DPAD_RIGHT", Enter: "KEYCODE_DPAD_CENTER", Escape: "KEYCODE_BACK",
  Backspace: "KEYCODE_BACK", m: "KEYCODE_MENU", i: "KEYCODE_INFO", n: "KEYCODE_MEDIA_NEXT",
  b: "KEYCODE_PROG_BLUE",
};

function svgBanner(label, color) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="${color}"/>` +
    `<text x="160" y="104" font-family="sans-serif" font-size="34" font-weight="700" fill="#fff" text-anchor="middle">${label}</text></svg>`;
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

function devPlatform(params) {
  const STATE_KEY = "lamplauncher-state";
  const dev = {
    keepScreenOn: false,
    launched: [],
    youtube: [],
    offline: false,
    screenOn: params.get("standby") !== "1",
    foreground: true,
  };
  let frame = null;
  let away = null;

  // another app in front of LampLauncher (h = the remote's Home button comes back)
  function goAway(text) {
    if (!away) {
      away = document.createElement("div");
      away.id = "dev-away";
      away.style.cssText = "position:fixed;inset:0;z-index:30;background:#111;color:#ddd;display:flex;" +
        "flex-direction:column;align-items:center;justify-content:center;gap:2vh;font:2vw sans-serif";
      document.body.appendChild(away);
    }
    away.innerHTML = "";
    const big = document.createElement("div");
    big.textContent = text;
    const small = document.createElement("div");
    small.textContent = "(press H for Home)";
    small.style.opacity = "0.6";
    away.append(big, small);
    if (dev.foreground) {
      dev.foreground = false;
      p.onLifecycle?.("stop");
    }
  }

  function home() {
    if (!dev.screenOn) return;
    if (away) {
      away.remove();
      away = null;
    }
    if (!dev.foreground) {
      dev.foreground = true;
      p.onLifecycle?.("start");
    }
    p.onLifecycle?.("home_intent");
  }
  const p = {
    name: "dev",
    initialState: localStorage.getItem(STATE_KEY),
    apps: [
      { id: "@settings", label: "Settings", icon: svgBanner("Settings", "#3c4a5c"), banner: true },
      { id: "com.google.android.youtube.tv", label: "YouTube", icon: svgBanner("YouTube", "#c4302b"), banner: true },
      { id: "com.netflix.ninja", label: "Netflix", icon: svgBanner("NETFLIX", "#141414"), banner: true },
    ],
    info: { adminUrl: `${location.origin}/admin`, isHome: true, version: "dev" },
    // ?wake=1: as if the box had just been switched on (the default cam opens)
    boot: { screenOn: dev.screenOn, foreground: true, wake: params.get("wake") === "1" },
    saveState(json) { localStorage.setItem(STATE_KEY, json); },
    setKeepScreenOn(on) { dev.keepScreenOn = on; },
    openYouTube(url) {
      dev.youtube.push(url);
      goAway(`\u25B6 YouTube app: ${url}`);
    },
    showSite(url) {
      if (!frame) {
        frame = document.createElement("iframe");
        frame.id = "dev-site";
        frame.allow = "autoplay";
        document.body.appendChild(frame);
      }
      frame.src = url;
    },
    hideSite() {
      if (frame) {
        frame.remove();
        frame = null;
      }
    },
    siteEval(js) {
      if (!frame) return;
      try {
        frame.contentWindow.eval(js);
      } catch (e) {
        frame.src = frame.src; // cross-origin: just reload
      }
    },
    launchApp(id) {
      dev.launched.push(id);
      goAway(`App: ${id}`);
    },
    wakeScreen() { if (!dev.screenOn) setScreen(true); },
    // LampLauncherDev.state.offline = true pretends the network is down
    online: () => (dev.offline ? Promise.resolve(false) : canReachYouTube()),
    apiReply(id, result) {
      fetch("/dev/reply", { method: "POST", body: JSON.stringify({ id, ...result }) });
    },
    ready() {},
  };

  function setScreen(on) {
    dev.screenOn = on;
    document.documentElement.style.filter = on ? "" : "brightness(0.15)";
    p.onLifecycle?.(on ? "screen_on" : "screen_off");
    // like a Google TV box: waking up brings the home app (LampLauncher) to the front
    if (on && !dev.foreground) {
      if (away) {
        away.remove();
        away = null;
      }
      dev.foreground = true;
      p.onLifecycle?.("start");
    }
  }

  // keyboard -> Android key names; a long Enter is a long press of OK
  let okDown = 0;
  window.addEventListener("keydown", (e) => {
    if (e.key === "p") return setScreen(!dev.screenOn); // the box's power button
    if (e.key === "h") return home(); // the remote's Home button
    const key = DEV_KEYS[e.key];
    if (!key) return;
    e.preventDefault();
    if (key === "KEYCODE_DPAD_CENTER") {
      if (!e.repeat) okDown = Date.now();
      return;
    }
    p.onKey?.(key, { repeat: e.repeat ? 1 : 0, long: false });
  });
  window.addEventListener("keyup", (e) => {
    if (DEV_KEYS[e.key] !== "KEYCODE_DPAD_CENTER" || !okDown) return;
    const long = Date.now() - okDown >= 600;
    okDown = 0;
    p.onKey?.("KEYCODE_DPAD_CENTER", { repeat: 0, long });
  });

  // the phone cam manager's requests arrive through the dev server
  try {
    const events = new EventSource("/dev/events");
    events.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      p.onApi?.(m.id, m.method, m.path, m.body || {});
    };
  } catch (e) { /* opened from a file: no cam manager */ }

  // hooks for tests and the browser console
  window.LampLauncherDev = {
    key: (name, opts = {}) => p.onKey?.(name, { repeat: 0, long: false, ...opts }),
    life: (ev) => {
      if (ev === "screen_on" || ev === "screen_off") setScreen(ev === "screen_on");
      else p.onLifecycle?.(ev);
    },
    home,
    state: dev,
  };
  return Promise.resolve(p);
}
