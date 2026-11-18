// Is it light at a cam right now? Plus the cam's local clock.
import { sunElevation, sunTimes } from "./sun.js";

const MIN = 60000;
// The sun's centre is this far below the horizon at sunrise and sunset
// (refraction and the sun's size), the usual definition of "the sun is up".
const HORIZON = -0.833;
// Below the horizon but less than this: dawn or dusk (civil twilight).
const TWILIGHT = -6;

const zoneCache = new Map();
function zoneFormatter(tz) {
  if (!tz) return null;
  if (!zoneCache.has(tz)) {
    let fmt = null;
    try {
      fmt = new Intl.DateTimeFormat(undefined, { timeZone: tz, hour: "numeric", minute: "2-digit" });
    } catch (e) {
      fmt = null;
    }
    zoneCache.set(tz, fmt);
  }
  return zoneCache.get(tz);
}

export function validZone(tz) {
  return zoneFormatter(tz) !== null;
}

/** Does the cam have a place on the globe? */
export function onGlobe(cam) {
  return Number.isFinite(cam.lat) && Number.isFinite(cam.lon);
}

/** The time at the cam ("7:12 AM", or "07:12" depending on the TV's language), or null without a time zone. */
export function camClock(cam, date) {
  const fmt = zoneFormatter(cam.tz);
  return fmt ? fmt.format(date) : null;
}

/** "day" while the sun is up at the cam, otherwise "night"; null for cams without a location. */
export function light(cam, date) {
  if (!onGlobe(cam)) return null;
  return sunElevation(cam.lat, cam.lon, date) > HORIZON ? "day" : "night";
}

/** The next sunrise at the cam after `now`, or null (polar night or midnight sun). */
export function nextSunrise(cam, now) {
  if (!onGlobe(cam)) return null;
  // the cam's calendar day by the sun (no time zone needed)
  const solar = new Date(now.getTime() + (cam.lon / 15) * 3600000);
  for (const offset of [-1, 0, 1, 2]) {
    const d = new Date(Date.UTC(solar.getUTCFullYear(), solar.getUTCMonth(), solar.getUTCDate() + offset));
    const t = sunTimes({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }, cam.lat, cam.lon);
    if (t.sunrise && t.sunrise > now) return t.sunrise;
  }
  return null;
}

/** "45m", "2h 05m" */
export function formatDuration(minutes) {
  minutes = Math.max(1, Math.round(minutes));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${String(m).padStart(2, "0")}m` : `${h}h`;
}

/**
 * What the light is like at the cam, for the screen:
 * {light: "day"|"night"|null, icon: "☀"|"🌙"|"", text: "Daylight" | "Dawn · sunrise in 20m" | "Dusk" | "Night · sunrise in 5h 10m"}
 */
export function sunState(cam, now) {
  if (!onGlobe(cam)) return { light: null, icon: "", text: "" };
  const elevation = sunElevation(cam.lat, cam.lon, now);
  if (elevation > HORIZON) return { light: "day", icon: "☀", text: "Daylight" };
  const rising = sunElevation(cam.lat, cam.lon, new Date(now.getTime() + 10 * MIN)) > elevation;
  let text = elevation > TWILIGHT ? (rising ? "Dawn" : "Dusk") : "Night";
  if (rising || elevation <= TWILIGHT) {
    const next = nextSunrise(cam, now);
    if (next) text += ` · sunrise in ${formatDuration((next - now) / MIN)}`;
  }
  return { light: "night", icon: "\u{1F319}", text };
}
