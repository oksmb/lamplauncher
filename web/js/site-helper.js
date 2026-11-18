// Injected by LampLauncher into the full-screen site view (WindowSwap and "web" cams).
// The Android app handles the remote; this only makes the page TV-friendly.
// WindowSwap's /Window page already shows one window full screen, and OK on the
// remote reloads it for another, so nothing on the page needs clicking.
(function () {
  "use strict";
  if (window.top !== window) return; // only the top-level document
  if (window.__lampLauncherHelper) return; // already injected into this page
  window.__lampLauncherHelper = true;
  if (location.protocol !== "http:" && location.protocol !== "https:") return;

  function addStyle() {
    if (document.getElementById("lamplauncher-style")) return;
    var style = document.createElement("style");
    style.id = "lamplauncher-style";
    style.textContent = "html,body{cursor:none!important}"; // no mouse pointer on the TV
    (document.head || document.documentElement).appendChild(style);
  }
  addStyle();
  document.addEventListener("DOMContentLoaded", addStyle);
})();
