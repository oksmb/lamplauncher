// Where the sun is: sunrise and sunset times (the standard "sunrise equation",
// good to a minute or two), the point where it's overhead, and its height in the sky.

const J2000 = 2451545.0;
const UNIX_EPOCH_JD = 2440587.5;
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;
const mod = (a, n) => ((a % n) + n) % n;

function jdToDate(jd) {
  return new Date((jd - UNIX_EPOCH_JD) * 86400000);
}

/**
 * Sun times for a calendar day at a location.
 * @param {{year:number, month:number, day:number}} day local calendar date (month 1-12)
 * @param {number} lat degrees north
 * @param {number} lon degrees east
 * @returns {{sunrise: Date|null, noon: Date, sunset: Date|null, polar: null|"day"|"night"}}
 */
export function sunTimes(day, lat, lon) {
  // Julian day number at 12:00 UTC of the given date
  const jdNoon = Date.UTC(day.year, day.month - 1, day.day, 12) / 86400000 + UNIX_EPOCH_JD;
  const n = Math.round(jdNoon - J2000 + 0.0008);
  const jStar = n - lon / 360;
  const m = rad(mod(357.5291 + 0.98560028 * jStar, 360));
  const c = 1.9148 * Math.sin(m) + 0.02 * Math.sin(2 * m) + 0.0003 * Math.sin(3 * m);
  const lambda = rad(mod(deg(m) + c + 180 + 102.9372, 360));
  const jTransit = J2000 + jStar + 0.0053 * Math.sin(m) - 0.0069 * Math.sin(2 * lambda);
  const sinD = Math.sin(lambda) * Math.sin(rad(23.4397));
  const cosD = Math.cos(Math.asin(sinD));
  const phi = rad(lat);
  const cosW = (Math.sin(rad(-0.833)) - Math.sin(phi) * sinD) / (Math.cos(phi) * cosD);
  const noon = jdToDate(jTransit);
  if (cosW < -1 || cosW > 1) {
    return { sunrise: null, noon, sunset: null, polar: cosW < -1 ? "day" : "night" };
  }
  const w = deg(Math.acos(cosW));
  return {
    sunrise: jdToDate(jTransit - w / 360),
    noon,
    sunset: jdToDate(jTransit + w / 360),
    polar: null,
  };
}

/**
 * The point on Earth where the sun is straight overhead at `date` (the middle of
 * the lit half of the globe). Low-precision solar position, good to ~0.1°.
 * @returns {{lat:number, lon:number}} degrees
 */
export function subsolarPoint(date) {
  const n = date.getTime() / 86400000 + UNIX_EPOCH_JD - J2000; // days since J2000
  const meanLon = mod(280.46 + 0.9856474 * n, 360);
  const g = rad(mod(357.528 + 0.9856003 * n, 360));
  const lambda = rad(meanLon + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g));
  const eps = rad(23.439 - 0.0000004 * n);
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const gmst = mod(280.46061837 + 360.98564736629 * n, 360); // sidereal time at Greenwich
  return { lat: deg(dec), lon: mod(deg(ra) - gmst + 180, 360) - 180 };
}

/** The sun's height above the horizon at a place, in degrees (negative: below it). */
export function sunElevation(lat, lon, date) {
  const s = subsolarPoint(date);
  const a = rad(lat);
  const b = rad(s.lat);
  const cos = Math.sin(a) * Math.sin(b) + Math.cos(a) * Math.cos(b) * Math.cos(rad(lon - s.lon));
  return deg(Math.asin(Math.max(-1, Math.min(1, cos))));
}
