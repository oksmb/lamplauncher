// Phone-friendly cam manager for LampLauncher.
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var form = $("form");
  var editing = null;
  var data = null;

  function api(method, url, body) {
    return fetch(url, {
      method: method,
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (r) {
      return r.text().then(function (t) {
        var body = null;
        try { body = JSON.parse(t); } catch (e) { /* not JSON */ }
        if (!r.ok) throw new Error((body && body.error) || t || r.statusText);
        return body;
      });
    });
  }

  var REMOTE = [
    ["power", "⏻ On/off"], ["home", "Home"], ["up", "▲"], ["back", "Back"], ["menu", "Hold OK"],
    [null, ""], ["left", "◀"], ["ok", "OK"], ["right", "▶"], ["info", "Info"],
    [null, ""], [null, ""], ["down", "▼"], [null, ""], ["next", "Next"],
  ];
  REMOTE.forEach(function (b) {
    if (!b[0]) { $("remote").appendChild(document.createElement("span")); return; }
    var btn = document.createElement("button");
    btn.textContent = b[1];
    btn.onclick = function () { api("POST", "/api/action/" + b[0]); };
    $("remote").appendChild(btn);
  });

  try {
    Intl.supportedValuesOf("timeZone").forEach(function (z) {
      var o = document.createElement("option");
      o.value = z;
      $("zones").appendChild(o);
    });
  } catch (e) { /* older browser: free text is fine */ }

  function load() {
    return Promise.all([api("GET", "/api/cams"), api("GET", "/api/prefs")]).then(function (r) {
      data = r[0];
      draw();
      drawPrefs(r[1]);
    });
  }

  // ---- playback preferences, remote buttons, setup check
  var prefsForm = $("prefs");
  var prefsLoaded = false;
  var lastKey = null;
  var ACTION_LABELS = {
    menu: "Hold OK (make default)", info: "Info", next: "Next cam / another window", ok: "OK", back: "Back",
    home: "Home", up: "Up", down: "Down", left: "Left", right: "Right", power: "On/off", none: "Ignore it",
  };

  function drawPrefs(d) {
    if (!prefsLoaded) {
      prefsLoaded = true;
      prefsForm.preview.value = d.prefs.preview || "video";
      var sel = $("assign-action");
      d.actions.concat(["none"]).forEach(function (a) {
        var o = document.createElement("option");
        o.value = a;
        o.textContent = ACTION_LABELS[a] || a;
        sel.appendChild(o);
      });
      sel.value = "menu";
    }
    lastKey = d.lastUnknownKey && d.lastUnknownKey.key;
    $("last-key").textContent = lastKey
      ? "Last unrecognised button: " + lastKey.replace("KEYCODE_", "")
      : "No unrecognised button pressed yet.";
    $("assign").hidden = !lastKey;
    var list = $("keys");
    list.textContent = "";
    Object.keys(d.keys).forEach(function (k) {
      var li = document.createElement("li");
      li.className = "check";
      li.textContent = k.replace("KEYCODE_", "") + " → " + (ACTION_LABELS[d.keys[k] || "none"] || d.keys[k]) + " ";
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = "Reset";
      b.onclick = function () {
        var keys = {};
        keys[k] = "default";
        api("PUT", "/api/prefs", { keys: keys }).then(load);
      };
      li.appendChild(b);
      list.appendChild(li);
    });
    var info = d.info || {};
    $("setup").hidden = info.isHome !== false;
    $("setup-cmds").textContent = (info.homeCommands || []).join("\n");
  }

  prefsForm.onsubmit = function (e) {
    e.preventDefault();
    $("prefs-error").textContent = "";
    api("PUT", "/api/prefs", { prefs: { preview: prefsForm.preview.value } }).then(function () {
      $("saved").textContent = "Saved";
      setTimeout(function () { $("saved").textContent = ""; }, 2000);
    }).catch(function (err) { $("prefs-error").textContent = err.message; });
  };

  $("assign-save").onclick = function () {
    if (!lastKey) return;
    var keys = {};
    keys[lastKey] = $("assign-action").value;
    api("PUT", "/api/prefs", { keys: keys }).then(load).catch(function (e) { alert(e.message); });
  };

  function draw() {
    var list = $("cams");
    list.textContent = "";
    data.cams.forEach(function (cam) {
      var li = document.createElement("li");
      li.className = "cam";
      var top = document.createElement("div");
      top.className = "top";
      var name = document.createElement("span");
      name.className = "name";
      name.textContent = (data.favorite === cam.id ? "★ " : "") + cam.name;
      top.appendChild(name);
      var tag = document.createElement("span");
      var status = data.status[cam.id];
      if (cam.type === "youtube") {
        tag.className = "tag " + (data.resolved[cam.id] ? "ok" : status === "offline" ? "off" : "");
        tag.textContent = data.resolved[cam.id] ? "found" : status === "offline" ? "not live" : "checking";
      } else {
        tag.className = "tag";
        tag.textContent = cam.type;
      }
      top.appendChild(tag);
      li.appendChild(top);
      var src = document.createElement("div");
      src.className = "src";
      var placed = cam.lat != null && cam.lon != null;
      var bits = [cam.location, cam.source, cam.match && "title ~ " + cam.match, cam.tz,
        placed ? "on the globe at " + cam.lat + ", " + cam.lon : "beside the globe (no latitude/longitude)"];
      src.textContent = bits.filter(Boolean).join(" · ");
      li.appendChild(src);
      var actions = document.createElement("div");
      actions.className = "actions";
      [
        ["Open on TV", function () { return api("POST", "/api/cams/" + cam.id + "/play"); }],
        [data.favorite === cam.id ? "Not default" : "★ Make default", function () { return api("POST", "/api/cams/" + cam.id + "/favorite"); }],
        ["Edit", function () { startEdit(cam); return Promise.resolve(); }],
        ["Delete", function () {
          if (!confirm("Delete " + cam.name + "?")) return Promise.resolve();
          return api("DELETE", "/api/cams/" + cam.id);
        }],
      ].forEach(function (a) {
        var btn = document.createElement("button");
        btn.textContent = a[0];
        btn.disabled = !!a[2];
        btn.onclick = function () { a[1]().then(load).catch(function (e) { alert(e.message); }); };
        actions.appendChild(btn);
      });
      li.appendChild(actions);
      list.appendChild(li);
    });
  }

  function syncType() {
    var t = form.type.value;
    form.querySelector(".for-source").hidden = t === "windowswap";
    form.querySelector(".for-match").hidden = t !== "youtube";
    $("check").parentNode.hidden = t !== "youtube";
    form.querySelector(".for-source span").hidden = t !== "youtube";
    form.source.placeholder = t === "web" ? "https://…" : "https://www.youtube.com/watch?v=… or @CornellBirdCams";
  }
  form.type.onchange = syncType;

  function startEdit(cam) {
    editing = cam.id;
    ["type", "name", "source", "match", "location", "tz", "lat", "lon"].forEach(function (k) {
      form[k].value = cam[k] == null ? "" : cam[k];
    });
    $("form-title").textContent = "Edit " + cam.name;
    $("save").textContent = "Save";
    $("cancel").hidden = false;
    syncType();
    form.scrollIntoView({ behavior: "smooth" });
  }

  function resetForm() {
    editing = null;
    form.reset();
    $("form-title").textContent = "Add a cam";
    $("save").textContent = "Add cam";
    $("cancel").hidden = true;
    $("form-error").textContent = "";
    $("check-result").textContent = "";
    syncType();
  }
  $("cancel").onclick = resetForm;

  $("check").onclick = function () {
    $("check-result").textContent = "Checking…";
    api("POST", "/api/check", { source: form.source.value, match: form.match.value }).then(function (r) {
      $("check-result").textContent = r.ok
        ? "Found: youtube.com/watch?v=" + r.video_id + (r.kind === "channel" ? " (live now)" : "")
        : r.error;
    }).catch(function (e) { $("check-result").textContent = e.message; });
  };

  form.onsubmit = function (e) {
    e.preventDefault();
    var body = {};
    ["type", "name", "source", "match", "location", "tz", "lat", "lon"].forEach(function (k) {
      body[k] = form[k].value.trim();
    });
    $("form-error").textContent = "";
    var req = editing ? api("PUT", "/api/cams/" + editing, body) : api("POST", "/api/cams", body);
    req.then(function () { resetForm(); return load(); })
      .catch(function (err) { $("form-error").textContent = err.message; });
  };

  syncType();
  load();
  setInterval(load, 15000);
})();
