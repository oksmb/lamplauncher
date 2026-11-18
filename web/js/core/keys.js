// Remote buttons -> app actions.
//
// The Android side sends Android key names (KeyEvent.keyCodeToString, e.g.
// "KEYCODE_DPAD_UP"). Power, Home and Volume never get here: the system handles
// those (power and volume control the TV over HDMI-CEC; Home opens LampLauncher when
// it's the home app). Remotes without a Menu button use a long press on OK
// ("menu": on the globe, make the highlighted cam the default).

export const ACTIONS = ["up", "down", "left", "right", "ok", "back", "home", "menu", "info", "next", "power"];
export const REPEATABLE = new Set(["up", "down", "left", "right"]);

export const DEFAULT_KEYS = {
  KEYCODE_DPAD_UP: "up",
  KEYCODE_DPAD_DOWN: "down",
  KEYCODE_DPAD_LEFT: "left",
  KEYCODE_DPAD_RIGHT: "right",
  KEYCODE_DPAD_CENTER: "ok",
  KEYCODE_ENTER: "ok",
  KEYCODE_NUMPAD_ENTER: "ok",
  KEYCODE_BUTTON_A: "ok",
  KEYCODE_MEDIA_PLAY_PAUSE: "info",
  KEYCODE_BACK: "back",
  KEYCODE_ESCAPE: "back",
  KEYCODE_BUTTON_B: "back",
  KEYCODE_MENU: "menu",
  KEYCODE_GUIDE: "menu",
  KEYCODE_BOOKMARK: "menu",
  KEYCODE_INFO: "info",
  KEYCODE_CAPTIONS: "info",
  KEYCODE_CHANNEL_UP: "next",
  KEYCODE_MEDIA_NEXT: "next",
  KEYCODE_MEDIA_FAST_FORWARD: "next",
};

const OK_KEYS = new Set(["KEYCODE_DPAD_CENTER", "KEYCODE_ENTER", "KEYCODE_NUMPAD_ENTER", "KEYCODE_BUTTON_A"]);

/**
 * @param {string} key Android key name
 * @param {{repeat?:number, long?:boolean}} opts
 * @param {Object<string,string>} overrides user mappings (key name -> action, "" to ignore)
 * @returns {string|null} action, or null if the key isn't mapped / should be ignored
 */
export function actionFor(key, { repeat = 0, long = false } = {}, overrides = {}) {
  let action = key in overrides ? overrides[key] : DEFAULT_KEYS[key];
  if (long && OK_KEYS.has(key) && !(key in overrides)) action = "menu";
  if (!action || !ACTIONS.includes(action)) return null;
  if (repeat > 0 && !REPEATABLE.has(action)) return null;
  return action;
}

export function isKnownKey(key, overrides = {}) {
  return key in overrides || key in DEFAULT_KEYS;
}
