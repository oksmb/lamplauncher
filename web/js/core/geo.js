// Globe geometry shared by the controller (which cam is next) and the screen
// (where to draw things). Orthographic view: x right, y up, z toward the viewer;
// a unit sphere, so a point is on the visible side when z > 0.
import { subsolarPoint } from "./sun.js";

const RAD = Math.PI / 180;
// How much the globe tilts toward a cam's latitude (all the way would put the
// poles in the middle of the screen for cams far north or south).
const TILT = 0.55;
const MAX_TILT = 35;

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Longitude in [-180, 180). */
export function normLon(lon) {
  if (lon >= -180 && lon < 180) return lon;
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

/** The shortest signed turn from longitude `from` to `to`, in degrees. */
export function lonDelta(from, to) {
  return normLon(to - from);
}

/** A place as a point on the unit sphere (world space: y through the North Pole, z through 0°N 0°E). */
export function toVec(lat, lon) {
  const a = lat * RAD;
  const b = lon * RAD;
  return [Math.cos(a) * Math.sin(b), Math.sin(a), Math.cos(a) * Math.cos(b)];
}

/**
 * The rotation from view space to world space for a view centred on {lat, lon},
 * row-major. Its transpose goes from world to view.
 */
export function viewMatrix({ lat, lon }) {
  const sl = Math.sin(lon * RAD);
  const cl = Math.cos(lon * RAD);
  const sp = Math.sin(lat * RAD);
  const cp = Math.cos(lat * RAD);
  return [
    cl, -sp * sl, cp * sl,
    0, cp, sp,
    -sl, -sp * cl, cp * cl,
  ];
}

/** Where a place appears for a view matrix: {x, y, z} on the unit disc (z > 0: visible). */
export function project(m, lat, lon) {
  const [X, Y, Z] = toVec(lat, lon);
  return {
    x: m[0] * X + m[3] * Y + m[6] * Z,
    y: m[1] * X + m[4] * Y + m[7] * Z,
    z: m[2] * X + m[5] * Y + m[8] * Z,
  };
}

/** The view that puts a cam in the middle of the screen. */
export function camView(cam) {
  return { lat: clamp(cam.lat * TILT, -MAX_TILT, MAX_TILT), lon: normLon(cam.lon) };
}

/** The view that shows the sunlit half of the Earth. */
export function sunView(date) {
  const s = subsolarPoint(date);
  return { lat: clamp(s.lat * TILT + 10, -MAX_TILT, MAX_TILT), lon: s.lon };
}

/**
 * The order ◀ ▶ moves through the cams: west to east around the globe, then the
 * cams without a place on it (like WindowSwap), then round again.
 * @param {{id:string, lat:number|null, lon:number|null}[]} cams
 */
export function globeOrder(cams) {
  const placed = cams.filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lon));
  const others = cams.filter((c) => !placed.includes(c));
  placed.sort((a, b) => normLon(a.lon) - normLon(b.lon) || b.lat - a.lat);
  return [...placed, ...others].map((c) => c.id);
}

/**
 * Moves markers apart so close or identical places stay separately visible:
 * each group closer than `gap` is laid out on a small ring around its middle,
 * keeping their rough directions from each other (ties: in list order, left to right).
 * @param {{x:number, y:number}[]} points screen positions (not changed)
 * @param {number} gap minimum distance between markers
 * @returns {{x:number, y:number}[]}
 */
export function spread(points, gap) {
  const n = points.length;
  const parent = points.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y) < gap) parent[find(i)] = find(j);
    }
  }
  const groups = new Map();
  points.forEach((_, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(i);
  });
  const out = points.map((p) => ({ x: p.x, y: p.y }));
  for (const members of groups.values()) {
    const k = members.length;
    if (k < 2) continue;
    const cx = members.reduce((s, i) => s + points[i].x, 0) / k;
    const cy = members.reduce((s, i) => s + points[i].y, 0) / k;
    const radius = gap / 2 / Math.sin(Math.PI / k);
    const angle = (i) => {
      const dx = points[i].x - cx;
      const dy = points[i].y - cy;
      return Math.hypot(dx, dy) < 0.5 ? null : Math.atan2(dy, dx);
    };
    // order round the ring by direction from the middle; identical places left to right
    const order = [...members].sort((a, b) => {
      const ta = angle(a);
      const tb = angle(b);
      if (ta === null || tb === null) return members.indexOf(a) - members.indexOf(b);
      return ta - tb;
    });
    const start = angle(order[0]) ?? Math.PI; // first one on the left
    order.forEach((i, j) => {
      const t = start + (2 * Math.PI * j) / k;
      out[i] = { x: cx + radius * Math.cos(t), y: cy + radius * Math.sin(t) };
    });
  }
  return out;
}
