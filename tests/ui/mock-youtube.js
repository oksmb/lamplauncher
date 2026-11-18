// A stand-in for https://www.youtube.com/iframe_api used by the UI test: an
// embed player that "plays" a picture with the video ID on it, for the preview card.
(function () {
  function Player(target, opts) {
    var self = this;
    // LampLauncher builds the embed iframe itself and hands it to YT.Player
    var m = /embed\/([^?]+)/.exec(target.src || "");
    opts.videoId = opts.videoId || (m ? decodeURIComponent(m[1]) : "unknown");
    opts.width = opts.width || target.width;
    opts.height = opts.height || target.height;
    this.referrerPolicy = target.referrerPolicy;
    this.embedSrc = target.src;
    this.opts = opts;
    this.state = -1;
    this.muted = /[?&]mute=1/.test(target.src || "");
    window.__mockPlayers = (window.__mockPlayers || []).concat([this]);
    var frame = document.createElement("iframe");
    frame.width = opts.width;
    frame.height = opts.height;
    frame.style.border = "0";
    frame.srcdoc = "<body style='margin:0;height:100vh;background:linear-gradient(180deg,#203a5a 0%,#f2a65a 55%,#3d5a3a 56%,#1e2d1c 100%);" +
      "font:40px sans-serif;color:#fff;display:flex;align-items:flex-end;justify-content:flex-end'>" +
      "<p style='margin:24px;opacity:.7'>mock " + opts.videoId + "</p></body>";
    target.parentNode.replaceChild(frame, target);
    this.iframe = frame;
    setTimeout(function () { if (!self.destroyed) opts.events.onReady({ target: self }); }, 100);
  }
  Player.prototype._set = function (s) {
    if (this.destroyed) return;
    this.state = s;
    this.opts.events.onStateChange({ data: s, target: this });
  };
  Player.prototype.getPlayerState = function () { return this.state; };
  Player.prototype.playVideo = function () {
    var self = this;
    if (this.state === 1) return;
    this._set(3);
    setTimeout(function () { self._set(1); }, 300);
  };
  Player.prototype.mute = function () { this.muted = true; };
  Player.prototype.unMute = function () { this.muted = false; };
  Player.prototype.destroy = function () { this.destroyed = true; this.iframe.remove(); };
  window.YT = { Player: Player, PlayerState: { ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3 } };
  if (window.onYouTubeIframeAPIReady) window.onYouTubeIframeAPIReady();
})();
