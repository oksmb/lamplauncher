# LampLauncher

A morning "virtual window" for a **Walmart Onn** (or any Google TV) streaming box:
part light lamp for dark winter mornings, part launcher (it replaces the box's home
screen).
Press **power** on the box's remote: the TV turns on and your default live
camera opens in the YouTube app, at the best quality your TV can show. Press
**Home** and you're on a slowly lit **globe** with a dot for every cam: pick another
with ◀ ▶. Press **power** again: the TV turns off until tomorrow.

- **One press to start.** No menus. The default (★) cam opens by itself.
- **A globe of cams.** The home screen is the Earth, turned toward the side that's
  in sunlight, with the night side dark (and its city lights on). Each cam is a
  dot; the default is a star. ◀ ▶ spin the globe from cam to cam, and a small live
  preview shows the one you're on, with its local time and ☀ daylight or 🌙 night
  there.
- **The YouTube app plays the cams,** so you get the same picture quality as
  watching YouTube normally (4K where the cam streams it).
- **Live cams from anywhere.** A cam can point at a channel (`@CornellBirdCams`),
  so it keeps working when a 24/7 stream restarts with a new video ID.
- **WindowSwap.** A random window somewhere in the world, orbiting beside the
  globe: ▲ to pick it, OK to open, OK again for another window.
- **Your other apps** are one press away: ▼ on the globe.
- **Cam manager on your phone** at `http://<box-address>:8686/admin`, so you never
  type a URL with a remote.

> LampLauncher started out as "PiRise", a Raspberry Pi project. That version is still
> in the git history (commit `b77b7d0`) if you ever want it. If you installed an
> early build called PiRise on your box, remove it first: `adb uninstall com.pirise.tv`
> (and if you made it the home app, make LampLauncher the home app instead, step 4).

## What you need

- An **Onn 4K, 4K Plus or 4K Pro** (Google TV), or another Google TV / Android TV box
  such as a Chromecast with Google TV. New Fire TV sticks running Vega OS can't
  install apps like this one.
- A TV with **HDMI-CEC** switched on. It's often called Anynet+ (Samsung),
  BRAVIA Sync (Sony), SimpLink (LG), or CEC / Device Link elsewhere.
- For the one-time setup: a computer with
  [`adb`](https://developer.android.com/tools/releases/platform-tools) (Android's
  platform tools), on the same network as the box.

## Install

### 1. Get the app

Download **LampLauncher.apk** from the
[latest release](https://github.com/oksmb/lamplauncher/releases/latest)
(direct link:
<https://github.com/oksmb/lamplauncher/releases/latest/download/LampLauncher.apk>).
Every build that passes the tests is released automatically, with a higher
version number than the last, and installs over an earlier release keeping your
cams and settings. (LampLauncher 3.0.19 and older were signed with a
different key: if you have one of those, uninstall it first.) (Or build it yourself; see
[Development](#development).)

### 2. Turn on developer mode on the box

1. **Settings → System → About**, highlight **Android TV OS build** and press OK
   seven times until it says you're a developer.
2. **Settings → System → Developer options**, turn on **USB debugging**.
3. Note the box's IP address: **Settings → Network & Internet** → your network.

### 3. Install LampLauncher

On your computer, replacing `192.168.1.50` with the box's address:

```bash
adb connect 192.168.1.50:5555
```

Accept the "Allow debugging?" prompt on the TV (tick "Always allow"), then:

```bash
adb install -r LampLauncher.apk
```

Open LampLauncher from the box's app list once. You should see the globe.

### 4. Make LampLauncher the home screen

When the box wakes up it shows its home screen. To have LampLauncher (and your cam) come
up instead, make LampLauncher the home app. This also makes the remote's **Home**
button bring you back to the globe from the YouTube app.

```bash
adb shell cmd package set-home-activity com.lamplauncher.tv/.MainActivity
```

```bash
adb shell pm disable-user --user 0 com.google.android.apps.tv.launcherx
```

```bash
adb shell pm disable-user --user 0 com.google.android.tungsten.setupwraith
```

Then press **Home** on the remote; LampLauncher should appear. If a command says it's
"illegal", run it again without `--user 0` (newer firmware changed this).

LampLauncher's globe has an **Apps** list (press ▼) with Settings and your other
apps, so nothing is lost. To get Google TV's home screen back:

```bash
adb shell pm enable com.google.android.apps.tv.launcherx
```

```bash
adb shell pm enable com.google.android.tungsten.setupwraith
```

A firmware update can occasionally re-enable Google's home screen; just run the
step 4 commands again. The cam manager shows a reminder when LampLauncher isn't the
home app.

### 5. Let the box control the TV

On the box:

- **Settings → System → HDMI-CEC** (on some boxes **Display & Sound → HDMI-CEC**):
  turn on HDMI-CEC, **One touch play** (turns the TV on) and **Turn off TV with
  device** (or similarly named options).
- **Settings → Remotes & Accessories → Set up remote buttons**: pick your TV, so
  the remote's power and volume buttons control the TV.

Test it: press power (the TV and box turn off), then press power again (the TV
comes on and your default cam opens in the YouTube app).

## Using it

| Where | Button | Does |
|---|---|---|
| Off | **Power** | TV on, the default (★) cam opens in the YouTube app |
| YouTube app | **Home** | Back to the globe, on the cam you were watching |
| YouTube app | **Back** | The YouTube app's own menus (Back again, or Home, returns) |
| Globe | ◀ ▶ | Spin to the next cam west or east (round and round the world) |
| Globe | ▲ | Up to WindowSwap, beside the globe (OK opens it; ▼ goes back down, ◀ ▶ carry on from the cam you were on) |
| Globe | **OK** | Watch the highlighted cam |
| Globe | **hold OK** | Make it the default cam (it becomes the ★); hold again for no default |
| Globe | ▼ | Your apps (Settings, YouTube, Netflix…); ▲ from the top row or **Back** returns |
| WindowSwap | **OK** or ▶ | Another random window |
| WindowSwap | **Back** or **Home** | Back to the globe |
| Anywhere | **Power** | TV off |
| Anywhere | **Volume** | The TV's volume, as usual |

**On the globe:** it starts turned toward the sunlit half of the Earth (on your
default cam if it's daylight there, otherwise the cam where the sun is highest)
and turns each time you pick another cam. Cams that are close together, like the
two Brooks River cams, sit side by side. The preview card (bottom right) shows the
highlighted cam's live picture (muted), where it is, the time there, and ☀ Daylight,
🌙 Dawn/Dusk or 🌙 Night with the time to sunrise. Cams without a location
(WindowSwap, or ones you add without coordinates) orbit beside the globe; ▲
reaches them (▲ again for the next one, if there are several).

**Coming back from YouTube without being thrown back in:** the default cam opens
only when the box wakes up (the screen comes on), never just because LampLauncher
comes to the front. So Home from the YouTube app always lands on the globe. Even if
Android closed LampLauncher in the background to free memory, it can tell a Home
press from a power-on.

**Waiting for the network:** the box often wakes up faster than its Wi-Fi
reconnects, and the YouTube app shows an error instead of waiting. So before
opening a cam, LampLauncher checks that YouTube can be reached. If it can't yet,
the globe says "Waiting for the internet…" and the cam opens as soon as it's back
(it checks every few seconds). Any button but OK stops waiting.

Turning the TV off with the TV's own remote also works, as long as "turn off
device with TV" (CEC) is on.

### The cam manager (on your phone)

Open `http://<box-address>:8686/admin` on your phone. The address is shown at the
top right of LampLauncher's globe. From there you can:

- **Add cams.** Paste a YouTube video link, a channel (`@NamibiaCam`, which plays
  whatever that channel is streaming now), or a channel plus **Title must contain**
  for channels with several streams at once (`@CornellBirdCams` + `Ontario`). Add
  its **latitude and longitude** to put it on the globe (right-click the spot in
  Google Maps to copy them) and its **time zone** for its local time. **Check link**
  shows what a link plays right now.
- **Make a cam the default, edit or delete** cams, or open one on the TV.
- **Globe:** a live preview of the highlighted cam, or just a still picture (less
  data, for slow connections).
- **Remote buttons:** press an unused button (like the blue or star button) on the
  remote, then assign it here, e.g. to make a cam the default without holding OK.
  Some buttons are taken by Google TV itself and never reach apps.
- **An on-screen remote**, handy for testing.

LampLauncher starts with 18 cams, from Sapsucker Woods (the default) and other bird
feeders to bears in Alaska, African waterholes and a New Zealand albatross
colony, plus WindowSwap. The defaults point at specific live videos. If a 24/7
stream restarts under a new video ID, the YouTube app says the video is unavailable
or shows a recording; paste its new link in the cam manager (Edit), or point the
cam at the channel instead.

## How it works

```
 Onn remote ─Bluetooth─> Android ─keys, screen on/off─> LampLauncher app (Kotlin)
     power ──> box sleeps/wakes ──HDMI-CEC──> TV off/on        │  message channel
                                                               v
 phone /admin ─HTTP :8686─> LampLauncher app ──relay──> web app (JavaScript, in a WebView)
                                                   │ state machine, globe (WebGL),
                                                   │ day and night, YouTube lookup
                                                   v
                   YouTube app (intent)  or  WindowSwap (second WebView)
```

- **Power and the TV:** the box's own power button and HDMI-CEC switch the TV.
  LampLauncher follows the box: when the screen comes on, it opens the default
  cam. The box's own screensaver and sleep timer apply, except while WindowSwap
  plays.
- **The web app** (`web/`) does the thinking: the remote's buttons, the globe, day
  and night at each cam, and finding a channel's current live stream from its
  public YouTube pages. It runs in a full-screen WebView, served from inside the
  app at `https://appassets.androidplatform.net` (YouTube refuses preview embeds
  from pages without a proper web address, "Error 153").
- **The globe** is drawn by the box's graphics chip (WebGL): one small shader turns
  each pixel back into a latitude and longitude, blends NASA's Blue Marble (day)
  and Earth at Night pictures by where the sun is overhead right now, and adds a
  twilight band and a thin atmosphere. It only redraws when something changes, so
  a still globe costs nothing. Without WebGL, it draws the same picture with the
  CPU at a lower resolution.
- **Opening a cam** hands its `youtube.com/watch` link to the YouTube app (an
  Android intent), so YouTube's own player picks the quality, as it does when you
  watch anything else. First it makes sure YouTube can be reached (a tiny request
  to `youtube.com/generate_204`, the one Chrome uses to test a connection), so a
  fast wake-up doesn't land in a YouTube network error.
- **The Android app** (`android/`) is a thin shell: it passes on remote buttons
  (turning a long OK press into Menu) and screen and app events, saves state,
  opens the YouTube app, shows WindowSwap full screen, lists and opens other apps,
  and runs the cam manager's web server. It talks to the web app over a message
  channel that only LampLauncher's own page can receive. It also notes when the
  screen goes on and off, so that if Android ever closes LampLauncher in the
  background, it still knows whether starting again is a power-on (open the
  default) or a Home press (show the globe).
- **WindowSwap:** WindowSwap's own full-screen player page
  (`window-swap.com/Window`), shown in a second WebView. It opens a random window
  by itself; OK reloads it for another.

All state (cams, the default, preferences) is one JSON file in the app's private
storage, so it survives app updates.

## Troubleshooting

**The box wakes up to Google TV's home screen, not my cam.** Do
[step 4](#4-make-lamplauncher-the-home-screen).

**Home does nothing after disabling Google's home screen.** The
`set-home-activity` command didn't take. Run it again, or re-enable Google's
launcher with the `pm enable` commands above.

**The TV doesn't turn on or off.** Check the HDMI-CEC settings on both the box and
the TV ([step 5](#5-let-the-box-control-the-tv)). Some TVs only accept CEC on
certain HDMI ports.

**OK does nothing, or says it couldn't open the YouTube app.** LampLauncher plays
cams in the official YouTube app (`com.google.android.youtube.tv`). Make sure it's
installed and up to date (Google TV boxes ship with it).

**The YouTube app says the video is unavailable, or shows a recording.** The cam's
24/7 stream restarted under a new video ID. Paste its new link in the cam manager
(from the YouTube app: Share → Copy link), or point the cam at the channel, which
always finds the current stream.

**A preview says "Not live right now".** That channel isn't streaming, or YouTube
changed its page layout. Paste the stream's video link instead.

**A preview stays a still picture.** Some streams don't allow embedding in other
apps; the YouTube app still plays them. On a slow connection, choose "Still picture
only" in the cam manager.

**The globe looks blocky.** The box's WebView may not offer WebGL, so LampLauncher
draws the globe without it, at a lower resolution. Everything else works the same.

**Logs.** With the box connected over adb:

```bash
adb logcat -s LampLauncher
```

The web app can also be inspected from Chrome on your computer at
`chrome://inspect` while connected.

## Development

The web app runs in any desktop browser, with the dev server standing in for the
Android app:

```bash
npm install
```

```bash
npm run dev
```

Then open <http://127.0.0.1:8686/> (the TV page) and <http://127.0.0.1:8686/admin>.
Keys: arrows, Enter (hold to make a cam the default), Esc for Back, `h` for Home,
`p` for the power button, `b` for an unmapped "blue" button. Opening a YouTube cam
or an app shows a stand-in screen; `h` comes back. Add `?wake=1` to start as if the
box had just been switched on, and `?webgl=0` to see the globe drawn without WebGL.

Tests:

```bash
npm test
```

```bash
npx playwright install chromium && npm run test:ui
```

`npm test` covers the core logic: where the sun is, day and night at a cam, the
globe's geometry, YouTube link parsing and channel lookup, the cam store, remote
buttons and the state machine, including Android's wake, Home and app-switching
events. The UI test drives the real page in Chromium through the dev server, at a
fixed date, with a fake YouTube (embed player and channel pages) and a fake
WindowSwap: it checks the globe's pixels (lit side brighter than the night side),
the dots and star, spinning, the preview, the YouTube hand-off, WindowSwap, the
apps list, the cam manager, and the globe without WebGL.

**Building the APK** needs the Android SDK (Android Studio installs it):

```bash
cd android && ./gradlew assembleRelease
```

The APK lands in `android/app/build/outputs/apk/release/`. Every push to GitHub
also builds and tests it, and each passing build of the default branch becomes a
GitHub Release with `LampLauncher.apk` attached (see `.github/workflows/build.yml`).
Released builds are numbered by the Actions run: version 3.0.N, version code N.

**Signing:** releases are signed with a private key that lives only in the
repository's GitHub secrets (`SIGNING_KEYSTORE_BASE64`, the PKCS12 keystore in
base64, and `SIGNING_PASSWORD`; see `.github/workflows/build.yml`). A build
without it, like one on your own computer, is signed with Android's debug key.
That's fine for trying changes, but Android won't install it over a released
LampLauncher (different signature): uninstall first, and note that uninstalling
clears your cams and default. To sign your own builds with your own key, point
`LAMPLAUNCHER_KEYSTORE` at a PKCS12 keystore (key alias `lamplauncher`) and set
`LAMPLAUNCHER_KEYSTORE_PASSWORD`. To install your build over one of your own
earlier builds, give it a higher number:

```bash
./gradlew assembleRelease -PbuildNumber=1000
```

```
web/            the app: index.html (TV), admin.html (phone), js/core (logic), js/ui, img (NASA Earth)
android/        the Android shell (Kotlin, framework APIs only)
tools/          devserver.mjs
tests/core/     unit tests (node --test)
tests/ui/       end-to-end test (Playwright) and the fake YouTube player
```

## Tested on

- **An Onn Google TV box** as the home screen: power-on with HDMI-CEC turning the
  TV on, the default cam opening in the YouTube app at full quality, and Home
  coming back to the globe.
- **Every build:** the core logic (unit tests) and the TV page and cam manager in
  Chromium (end-to-end test with a fake YouTube), and the Kotlin code compiled
  for Android.

Things that can differ on other boxes or firmware:

- **The YouTube hand-off:** opening `youtube.com/watch` links in the YouTube app
  is standard on Android TV, but if OK does nothing, `adb logcat -s LampLauncher`
  says which app it tried.
- **Waking up:** some boxes bring back the last app rather than the home screen
  after power-on; then the default cam doesn't open by itself.
- **Finding a channel's live stream:** reads YouTube's public pages, which change
  from time to time. Plain video links don't depend on it.
- **Remote buttons:** Power, Home, Volume and the app buttons (YouTube, Netflix…)
  belong to Google TV. Hold OK replaces the Menu button these remotes don't have.

Earth pictures: NASA Blue Marble and Earth at Night (public domain), resized from
the copies in the [three-globe](https://github.com/vasturiano/three-globe) examples.
