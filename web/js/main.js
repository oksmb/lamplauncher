// Boots LampLauncher: connects to the device, loads the saved state and wires the
// remote, the screen and the cam manager to the controller.
import { connectPlatform } from "./platform.js";
import { Controller } from "./core/controller.js";
import { Store } from "./core/store.js";
import { Resolver } from "./core/youtube.js";
import { createView } from "./ui/view.js";

// YouTube's pages can't be read from a web page directly; the app (or the dev
// server) fetches them for us at /proxy.
async function fetchText(url) {
  const res = await fetch(`proxy?url=${encodeURIComponent(url)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

const params = new URLSearchParams(location.search);
const platform = await connectPlatform();
const store = new Store(platform.initialState, (json) => platform.saveState(json));
const controller = new Controller({ store, resolver: new Resolver(fetchText), platform });
const view = createView({ webgl: params.get("webgl") !== "0" });

controller.subscribe((msg) => {
  if (msg.type === "state") view.render(msg);
  else if (msg.type === "toast") view.toast(msg.text);
});
controller.setInfo(platform.info);
controller.setApps(platform.apps);

platform.onKey = (key, opts) => controller.key(key, opts);
platform.onLifecycle = (ev) => controller.lifecycle(ev);
platform.onApps = (apps) => controller.setApps(apps);
platform.onInfo = (info) => controller.setInfo(info);
platform.onToast = (text) => view.toast(text);
platform.onApi = async (id, method, path, body) => platform.apiReply(id, await controller.api(method, path, body));

controller.start();
controller.boot(platform.boot);
platform.ready();

window.LampLauncher = { controller, store, view, platform };
