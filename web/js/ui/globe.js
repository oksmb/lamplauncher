// The Earth: NASA's Blue Marble where the sun is up, the Earth at night (city
// lights) where it isn't, a soft band of twilight between them and a thin
// atmosphere. Drawn with WebGL on the TV box's GPU, one pixel shader that turns
// each pixel of the disc back into a latitude and longitude. Without WebGL it
// draws the same picture with the CPU, at a lower resolution.
//
// Only draws when something changes (the view turns, the sun moves, a picture
// loads), so a still globe costs nothing.
import { viewMatrix, toVec, normLon, lonDelta } from "../core/geo.js";
import { subsolarPoint } from "../core/sun.js";

// The globe's radius as a share of the canvas's half-width (the rest is room for the
// atmosphere's glow, which fades out completely before the canvas's edge).
export const GLOBE_SCALE = 0.85;
const SPIN_MS = 900;
const MAX_PIXELS = 1600; // canvas size cap, in device pixels

const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);

/**
 * @param {HTMLCanvasElement} canvas a square canvas
 * @param {{dayUrl:string, nightUrl:string, onFrame?:(matrix:number[])=>void, webgl?:boolean}} o
 */
export function createGlobe(canvas, { dayUrl, nightUrl, onFrame, webgl = true }) {
  let view = { lat: 20, lon: 0 };
  let anim = null;
  let sun = [0, 0, 1];
  let raf = 0;
  const redraw = () => {
    if (!raf) raf = requestAnimationFrame(draw);
  };
  const renderer = (webgl && glRenderer(canvas, dayUrl, nightUrl, redraw)) || cpuRenderer(canvas, dayUrl, nightUrl, redraw);

  function draw() {
    raf = 0;
    if (anim) {
      const k = Math.min(1, (performance.now() - anim.start) / anim.ms);
      const e = ease(k);
      view = { lat: anim.from.lat + (anim.to.lat - anim.from.lat) * e, lon: normLon(anim.from.lon + anim.dLon * e) };
      if (k >= 1) anim = null;
      else redraw();
    }
    const m = viewMatrix(view);
    renderer.draw(m, sun);
    if (onFrame) onFrame(m);
  }

  function resize() {
    const css = canvas.clientWidth || 1;
    const size = Math.round(Math.min(MAX_PIXELS, css * Math.min(2, window.devicePixelRatio || 1) * renderer.quality));
    if (canvas.width !== size || canvas.height !== size) {
      canvas.width = size;
      canvas.height = size;
    }
    redraw();
  }

  return {
    kind: renderer.kind,
    /** Turn to a view ({lat, lon} at the middle of the screen); spins the short way round. */
    setView(target, { animate = true } = {}) {
      const to = { lat: target.lat, lon: normLon(target.lon) };
      const dLon = lonDelta(view.lon, to.lon);
      if (Math.abs(dLon) < 0.01 && Math.abs(to.lat - view.lat) < 0.01 && !anim) return;
      if (!animate) {
        anim = null;
        view = to;
      } else {
        // a longer turn takes a little longer, up to half again
        const ms = SPIN_MS * (0.75 + Math.min(1, Math.abs(dLon) / 180) * 0.75);
        anim = { from: { ...view }, to, dLon, start: performance.now(), ms };
      }
      redraw();
    },
    /** Light the globe for a moment in time. */
    setTime(date) {
      const s = subsolarPoint(date);
      const v = toVec(s.lat, s.lon);
      if (v.some((x, i) => Math.abs(x - sun[i]) > 1e-4)) {
        sun = v;
        redraw();
      }
    },
    resize,
    redraw,
    get view() { return view; },
    get spinning() { return Boolean(anim); },
    /** Whether the Earth pictures have loaded. */
    get loaded() { return renderer.loaded(); },
    /** Draws now and reads one pixel back ([r, g, b, a] at a fraction of the canvas), for tests. */
    pixel(fx, fy) {
      renderer.draw(viewMatrix(view), sun);
      return renderer.read(Math.min(canvas.width - 1, Math.floor(fx * canvas.width)), Math.min(canvas.height - 1, Math.floor(fy * canvas.height)));
    },
  };
}

// ------------------------------------------------------------------ WebGL
const VERTEX = `
attribute vec2 aPos;
varying vec2 vPos;
void main() { vPos = aPos; gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FRAGMENT = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D uDay;
uniform sampler2D uNight;
uniform mat3 uRot;     // view space -> world space
uniform vec3 uSun;     // towards the sun, world space
uniform float uScale;  // globe radius / canvas half-width
uniform float uPx;     // one pixel, in globe radii
uniform float uReady;  // 1 once the pictures have loaded
varying vec2 vPos;
const float PI = 3.14159265;
void main() {
  vec2 p = vPos / uScale;
  float r = length(p);
  float z = sqrt(max(0.0, 1.0 - r * r));
  vec3 n = uRot * vec3(p, z);
  float lat = asin(clamp(n.y, -1.0, 1.0));
  float lon = atan(n.x, n.z);
  vec2 uv = vec2(lon / (2.0 * PI) + 0.5, 0.5 - lat / PI);
#ifdef SEAM_FIX
  // longitude jumps at 180 degrees; use the u that doesn't jump within this pixel's neighbours
  float u2 = fract(uv.x + 0.5) - 0.5;
  if (fwidth(uv.x) > fwidth(u2) + 0.0001) uv.x = u2;
#endif
  vec3 dayC = mix(vec3(0.10, 0.22, 0.42), texture2D(uDay, uv).rgb, uReady);
  vec3 nightC = mix(vec3(0.02, 0.04, 0.09), texture2D(uNight, uv).rgb, uReady);
  float s = dot(n, uSun);
  float lit = smoothstep(-0.10, 0.08, s);               // twilight: about 6 degrees each side
  vec3 dayLit = dayC * (0.42 + 0.78 * sqrt(clamp(s, 0.0, 1.0)));
  vec3 col = mix(nightC * 0.8, dayLit, lit);
  col += vec3(0.30, 0.12, 0.02) * lit * (1.0 - lit) * 0.7; // warm light along the terminator
  float rim = pow(1.0 - z, 2.5);
  col = mix(col, vec3(0.42, 0.66, 1.0), rim * (0.12 + 0.45 * lit));
  // the glow just outside the edge, brighter on the sunlit side
  vec3 edgeN = uRot * vec3(p / max(r, 0.0001), 0.0);
  float sunnyEdge = smoothstep(-0.25, 0.35, dot(edgeN, uSun));
  float glow = exp(-max(r - 1.0, 0.0) * 24.0) * (0.10 + 0.55 * sunnyEdge);
  glow *= 1.0 - smoothstep(1.0 / uScale - 0.09, 1.0 / uScale, r); // gone before the canvas's edge
  vec4 outside = vec4(vec3(0.30, 0.55, 1.0) * glow, glow);
  float inside = 1.0 - smoothstep(1.0 - uPx, 1.0 + uPx, r);
  gl_FragColor = vec4(col, 1.0) * inside + outside * (1.0 - inside);
}`;

function glRenderer(canvas, dayUrl, nightUrl, redraw) {
  let gl = null;
  try {
    const opts = { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false };
    gl = canvas.getContext("webgl", opts) || canvas.getContext("experimental-webgl", opts);
  } catch (e) {
    gl = null;
  }
  if (!gl) return null;
  let prog = null;
  let loc = {};
  let ready = 0;
  let deriv = null;
  let aniso = null;

  function compile(type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
    return sh;
  }

  function texture(unit, url) {
    const tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const img = new Image();
    img.onload = () => {
      if (gl.isContextLost()) return;
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
      const pow2 = (x) => (x & (x - 1)) === 0;
      if (pow2(img.width) && pow2(img.height) && deriv) {
        // smooth when shrunk (near the edge of the globe); wraps round at 180 degrees
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, 4);
      }
      ready += 1;
      redraw();
    };
    img.onerror = () => console.warn(`globe picture ${url} didn't load`);
    img.src = url;
  }

  function init() {
    ready = 0;
    deriv = gl.getExtension("OES_standard_derivatives");
    aniso = gl.getExtension("EXT_texture_filter_anisotropic");
    prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERTEX));
    const head = deriv ? "#extension GL_OES_standard_derivatives : enable\n#define SEAM_FIX 1\n" : "";
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, head + FRAGMENT));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    loc = {};
    for (const u of ["uDay", "uNight", "uRot", "uSun", "uScale", "uPx", "uReady"]) loc[u] = gl.getUniformLocation(prog, u);
    gl.uniform1i(loc.uDay, 0);
    gl.uniform1i(loc.uNight, 1);
    texture(0, dayUrl);
    texture(1, nightUrl);
  }

  try {
    init();
  } catch (e) {
    console.warn("WebGL globe failed, drawing it without", e);
    return null;
  }
  canvas.addEventListener("webglcontextlost", (e) => e.preventDefault());
  canvas.addEventListener("webglcontextrestored", () => {
    try {
      init();
      redraw();
    } catch (e) {
      console.warn("couldn't restore the globe", e);
    }
  });

  return {
    kind: "webgl",
    quality: 1,
    loaded: () => ready >= 2,
    read(x, y) {
      const px = new Uint8Array(4);
      gl.readPixels(x, canvas.height - 1 - y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return Array.from(px);
    },
    draw(m, sun) {
      if (gl.isContextLost()) return;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(prog);
      gl.uniformMatrix3fv(loc.uRot, false, [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]);
      gl.uniform3fv(loc.uSun, sun);
      gl.uniform1f(loc.uScale, GLOBE_SCALE);
      gl.uniform1f(loc.uPx, 2 / (canvas.width * GLOBE_SCALE));
      gl.uniform1f(loc.uReady, ready >= 2 ? 1 : 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
  };
}

// --------------------------------------------------------------- without WebGL
// the same colours as the shader, 0-255
const BASE_DAY = [26, 56, 107];
const BASE_NIGHT = [5, 10, 23];
const WARM = [77, 31, 5];
const RIM = [107, 168, 255];

function cpuRenderer(canvas, dayUrl, nightUrl, redraw) {
  const ctx = canvas.getContext("2d");
  const W = 1024;
  const H = 512;
  const pics = {};
  const work = document.createElement("canvas");
  const wctx = work.getContext("2d");
  for (const [name, url] of [["day", dayUrl], ["night", nightUrl]]) {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = W;
      c.height = H;
      const cx = c.getContext("2d");
      cx.drawImage(img, 0, 0, W, H);
      try {
        pics[name] = cx.getImageData(0, 0, W, H).data;
      } catch (e) {
        console.warn("globe picture unreadable", e);
      }
      redraw();
    };
    img.src = url;
  }
  const smooth = (a, b, x) => {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };

  return {
    kind: "cpu",
    quality: 0.5,
    loaded: () => Boolean(pics.day && pics.night),
    read: (x, y) => Array.from(ctx.getImageData(x, y, 1, 1).data),
    draw(m, sun) {
      const size = Math.min(canvas.width, 420);
      if (work.width !== size) {
        work.width = size;
        work.height = size;
      }
      const out = wctx.createImageData(size, size);
      const px = out.data;
      const day = pics.day;
      const night = pics.night;
      const half = size / 2;
      const scale = GLOBE_SCALE * half;
      for (let j = 0; j < size; j++) {
        const y = (half - j - 0.5) / scale;
        for (let i = 0; i < size; i++) {
          const x = (i + 0.5 - half) / scale;
          const r2 = x * x + y * y;
          const o = (j * size + i) * 4;
          if (r2 > 1) {
            const r = Math.sqrt(r2);
            const ex = (m[0] * x + m[1] * y) / r;
            const ey = (m[3] * x + m[4] * y) / r;
            const ez = (m[6] * x + m[7] * y) / r;
            const glow = Math.exp(-(r - 1) * 24) * (0.1 + 0.55 * smooth(-0.25, 0.35, ex * sun[0] + ey * sun[1] + ez * sun[2])) *
              (1 - smooth(1 / GLOBE_SCALE - 0.09, 1 / GLOBE_SCALE, r));
            px[o] = 77 * glow;
            px[o + 1] = 140 * glow;
            px[o + 2] = 255 * glow;
            px[o + 3] = 255 * glow;
            continue;
          }
          const z = Math.sqrt(1 - r2);
          const nx = m[0] * x + m[1] * y + m[2] * z;
          const ny = m[3] * x + m[4] * y + m[5] * z;
          const nz = m[6] * x + m[7] * y + m[8] * z;
          const u = Math.atan2(nx, nz) / (2 * Math.PI) + 0.5;
          const v = 0.5 - Math.asin(Math.max(-1, Math.min(1, ny))) / Math.PI;
          const t = (Math.min(H - 1, Math.floor(v * H)) * W + Math.min(W - 1, Math.floor(u * W))) * 4;
          const s = nx * sun[0] + ny * sun[1] + nz * sun[2];
          const lit = smooth(-0.1, 0.08, s);
          const shade = 0.42 + 0.78 * Math.sqrt(Math.max(0, s));
          const rim = (1 - z) ** 2.5 * (0.12 + 0.45 * lit);
          for (let c = 0; c < 3; c++) {
            const d = day ? day[t + c] : BASE_DAY[c];
            const n = night ? night[t + c] : BASE_NIGHT[c];
            let col = n * 0.8 * (1 - lit) + d * shade * lit;
            col += WARM[c] * lit * (1 - lit) * 0.7;
            col = col * (1 - rim) + RIM[c] * rim;
            px[o + c] = col;
          }
          px[o + 3] = 255;
        }
      }
      wctx.putImageData(out, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(work, 0, 0, canvas.width, canvas.height);
    },
  };
}
