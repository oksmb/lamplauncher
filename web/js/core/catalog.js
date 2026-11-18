// Starter cams shown on first run. Edit, add or remove them from the cam manager
// (http://<box-address>:8686/admin). YouTube cams play in the box's YouTube app.
//
// A cam's source can be:
//   "<video ID or URL>"           -> exactly that video
//   "@Handle"                     -> that channel's current live stream
//   "@Handle" + match             -> the live stream on that channel whose title matches
// A 24/7 stream occasionally restarts under a new video ID; if one of these stops
// working, paste its new link in the cam manager (or use the channel instead).
// Lat/lon place the cam on the globe (and tell day from night there); tz gives its local time.

const cam = (id, name, location, url, lat, lon, tz) => ({
  id, name, location, type: "youtube", source: url, match: "", tz, lat, lon,
});

export const DEFAULT_CAMS = [
  cam("sapsucker-woods", "Sapsucker Woods", "Ithaca, New York",
    "https://www.youtube.com/watch?v=x10vL6_47Dw", 42.4764, -76.4525, "America/New_York"),
  cam("royal-albatross", "Royal Albatross", "Otago Peninsula, New Zealand",
    "https://www.youtube.com/watch?v=Mm_zVDDUeNA", -45.779, 170.7021, "Pacific/Auckland"),
  cam("panama-hummingbirds", "Panama Hummingbirds", "Panama City, Panama",
    "https://www.youtube.com/watch?v=0xFARCdZ3vA", 9.0056, -79.5154, "America/Panama"),
  cam("canopy-lodge", "Canopy Lodge", "El Valle de Antón, Panama",
    "https://www.youtube.com/watch?v=WtoxxHADnGk", 8.6024, -80.1302, "America/Panama"),
  cam("gettysburg", "Gettysburg", "Gettysburg, Pennsylvania",
    "https://www.youtube.com/watch?v=y9t1g8Ike6g", 39.8294, -77.229, "America/New_York"),
  cam("brooks-falls", "Brooks Falls", "Katmai, Alaska",
    "https://www.youtube.com/watch?v=J7ZrIDvqlic", 58.5544, -155.7914, "America/Anchorage"),
  cam("riffles", "Riffles", "Brooks River, Alaska",
    "https://www.youtube.com/watch?v=z7_GhJeFxQI", 58.5544, -155.7914, "America/Anchorage"),
  cam("ol-donyo-lodge", "ol Donyo Lodge", "Chyulu Hills, Kenya",
    "https://www.youtube.com/watch?v=XsOU8JnEpNM", -2.5009, 37.7549, "Africa/Nairobi"),
  cam("mississippi-river", "Mississippi River", "Upper Mississippi River",
    "https://www.youtube.com/watch?v=feR0k8-nkWE", 43.9215, -91.2855, "America/Chicago"),
  cam("namib-desert", "Namib Desert", "Namib Desert, Namibia",
    "https://www.youtube.com/watch?v=ydYDqZQpim8", -23.0923, 15.168, "Africa/Windhoek"),
  cam("sacramento-nwr", "Sacramento NWR", "Willows, California",
    "https://www.youtube.com/watch?v=1aPhtRjjzb0", 39.4298, -122.1916, "America/Los_Angeles"),
  cam("lost-creek-ranch", "Lost Creek Ranch", "Grand Teton, Wyoming",
    "https://www.youtube.com/watch?v=7Li473oJI30", 43.74, -110.586, "America/Denver"),
  cam("elk-refuge", "Elk Refuge", "Jackson, Wyoming",
    "https://www.youtube.com/watch?v=_2rvoH5oDcg", 43.5197, -110.7488, "America/Denver"),
  cam("camelthorn-waterhole", "Camelthorn Waterhole", "Kalahari, Botswana",
    "https://www.youtube.com/watch?v=mk02pEy3FdA", -21.0228, 24.4412, "Africa/Gaborone"),
  cam("safarihoek", "Safarihoek", "Etosha, Namibia",
    "https://www.youtube.com/watch?v=qwvk5hbEJnY", -18.8805, 16.3679, "Africa/Windhoek"),
  cam("sea-lion-beach", "Sea Lion Beach", "British Columbia, Canada",
    "https://www.youtube.com/watch?v=-uooI2satIQ", 50.5716, -126.7384, "America/Vancouver"),
  cam("lentorre-lodge", "Lentorre Lodge", "Lake Magadi, Kenya",
    "https://www.youtube.com/watch?v=bEmFpjwMOvs", -1.902, 36.0519, "Africa/Nairobi"),
  cam("simbavati", "Simbavati", "Timbavati, South Africa",
    "https://www.youtube.com/watch?v=zh5QHh9prA0", -24.2667, 31.2147, "Africa/Johannesburg"),
  {
    id: "windowswap", name: "WindowSwap", location: "A random window, anywhere",
    type: "windowswap", source: "", match: "", tz: "", lat: null, lon: null,
  },
];

export const DEFAULT_FAVORITE = "sapsucker-woods";
// WindowSwap's own full-screen player: a random window, no page clutter.
export const WINDOWSWAP_URL = "https://www.window-swap.com/Window";
