package com.lamplauncher.tv

import android.annotation.SuppressLint
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import android.util.Log
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.view.WindowManager
import android.webkit.ConsoleMessage
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.Inet4Address
import java.net.NetworkInterface
import java.util.concurrent.Executors

/**
 * LampLauncher's one screen: a full-screen WebView running the web app (the globe),
 * plus a second WebView that shows WindowSwap (or another web cam page) on top
 * when needed. YouTube cams open in the box's YouTube app.
 *
 * It is meant to be the box's home app, so Android brings it to the front when the
 * box wakes up; the web app then opens the default cam. The box itself turns the
 * TV on and off over HDMI-CEC with its power button.
 */
class MainActivity : Activity(), Bridge.Host {
    companion object {
        private const val LONG_PRESS_MS = 600L
        /** YouTube for Android TV / Google TV, then the phone app (some boxes), then any app for the link. */
        private val YOUTUBE_APPS = listOf("com.google.android.youtube.tv", "com.google.android.youtube", null)
        private val OK_KEYS = setOf(
            KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER,
            KeyEvent.KEYCODE_NUMPAD_ENTER, KeyEvent.KEYCODE_BUTTON_A,
        )

        /** Buttons the system should keep handling (TV power/volume/input, Home, assistant...). */
        private val SYSTEM_KEYS = setOf(
            KeyEvent.KEYCODE_POWER, KeyEvent.KEYCODE_TV_POWER, KeyEvent.KEYCODE_SLEEP,
            KeyEvent.KEYCODE_SOFT_SLEEP, KeyEvent.KEYCODE_WAKEUP, KeyEvent.KEYCODE_HOME,
            KeyEvent.KEYCODE_VOLUME_UP, KeyEvent.KEYCODE_VOLUME_DOWN, KeyEvent.KEYCODE_VOLUME_MUTE,
            KeyEvent.KEYCODE_MUTE, KeyEvent.KEYCODE_SETTINGS, KeyEvent.KEYCODE_TV_INPUT,
            KeyEvent.KEYCODE_ASSIST, KeyEvent.KEYCODE_VOICE_ASSIST, KeyEvent.KEYCODE_SEARCH,
            KeyEvent.KEYCODE_ALL_APPS, KeyEvent.KEYCODE_APP_SWITCH, KeyEvent.KEYCODE_NOTIFICATION,
            KeyEvent.KEYCODE_TV, KeyEvent.KEYCODE_BRIGHTNESS_UP, KeyEvent.KEYCODE_BRIGHTNESS_DOWN,
        )

        private fun isSystemKey(code: Int): Boolean {
            if (code in SYSTEM_KEYS) return true
            val name = KeyEvent.keyCodeToString(code)
            return name.startsWith("KEYCODE_TV_INPUT") || name.startsWith("KEYCODE_SYSTEM_NAVIGATION") ||
                name.startsWith("KEYCODE_VOLUME")
        }
    }

    private lateinit var ui: WebView
    private lateinit var site: WebView
    private lateinit var bridge: Bridge
    private lateinit var origin: LocalOrigin
    private val main = Handler(Looper.getMainLooper())
    private val io = Executors.newSingleThreadExecutor()
    private var started = false
    private var siteHelper: String? = null

    // long press on OK = Menu (Google TV remotes have no Menu button)
    private var okKey: String? = null
    private var okLongSent = false
    private val okLong = Runnable {
        okKey?.let {
            okLongSent = true
            bridge.key(it, 0, true)
        }
    }

    private val screenReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            when (intent.action) {
                Intent.ACTION_SCREEN_ON -> bridge.life("screen_on")
                Intent.ACTION_SCREEN_OFF -> bridge.life("screen_off")
            }
        }
    }

    private val stateFile: File get() = File(filesDir, "state.json")

    // ------------------------------------------------------------------ setup
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        origin = (application as LampLauncherApp).origin
        WebView.setWebContentsDebuggingEnabled(true) // chrome://inspect over adb, for troubleshooting

        val root = FrameLayout(this)
        root.setBackgroundColor(Color.BLACK)
        ui = newWebView()
        site = newWebView()
        site.visibility = View.GONE
        val full = ViewGroup.LayoutParams.MATCH_PARENT
        root.addView(ui, FrameLayout.LayoutParams(full, full))
        root.addView(site, FrameLayout.LayoutParams(full, full))
        setContentView(root)
        hideSystemBars()

        bridge = Bridge(this, ui)
        Bridge.current = bridge

        ui.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                origin.handle(request)

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                request.url.host != LocalOrigin.HOST // LampLauncher's page never navigates away

            override fun onPageFinished(view: WebView, url: String) {
                if (url.startsWith(LocalOrigin.ORIGIN)) bridge.connect()
            }

            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                Log.e(TAG, "web app renderer gone (crash=${detail.didCrash()}); restarting")
                bridge.pageGone()
                recreate()
                return true
            }
        }
        ui.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(m: ConsoleMessage): Boolean {
                if (m.messageLevel() == ConsoleMessage.MessageLevel.ERROR) {
                    Log.e(TAG, "web: ${m.message()} (${m.sourceId()}:${m.lineNumber()})")
                }
                return true
            }
        }

        site.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView, url: String) {
                if (url.startsWith("http")) injectSiteHelper(view)
            }

            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                Log.e(TAG, "site renderer gone; hiding it")
                (view.parent as? ViewGroup)?.removeView(view)
                view.destroy()
                site = newWebView()
                site.visibility = View.GONE
                site.webViewClient = this
                site.webChromeClient = WebChromeClient()
                root.addView(site, FrameLayout.LayoutParams(full, full))
                return true
            }
        }
        site.webChromeClient = WebChromeClient()

        val filter = IntentFilter().apply {
            addAction(Intent.ACTION_SCREEN_ON)
            addAction(Intent.ACTION_SCREEN_OFF)
        }
        if (Build.VERSION.SDK_INT >= 33) {
            registerReceiver(screenReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            registerReceiver(screenReceiver, filter)
        }

        ui.loadUrl(LocalOrigin.START_URL)
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun newWebView(): WebView = WebView(this).apply {
        setBackgroundColor(Color.BLACK)
        overScrollMode = View.OVER_SCROLL_NEVER
        isFocusable = false // the remote is handled in dispatchKeyEvent, not by page focus
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.mediaPlaybackRequiresUserGesture = false
        settings.textZoom = 100 // the layout scales with the screen already
        settings.setSupportZoom(false)
        settings.builtInZoomControls = false
    }

    @Suppress("DEPRECATION")
    private fun hideSystemBars() {
        window.addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN)
        if (Build.VERSION.SDK_INT >= 30) {
            window.insetsController?.hide(WindowInsets.Type.systemBars())
        } else {
            window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_FULLSCREEN or
                View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
        }
    }

    // -------------------------------------------------------------- lifecycle
    override fun onStart() {
        super.onStart()
        started = true
        bridge.life("start")
        bridge.info(deviceInfo()) // e.g. LampLauncher may have just been made the home app
        refreshApps()
    }

    override fun onResume() {
        super.onResume()
        hideSystemBars()
    }

    override fun onStop() {
        super.onStop()
        started = false
        bridge.life("stop")
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (intent.hasCategory(Intent.CATEGORY_HOME)) bridge.life("home_intent")
    }

    override fun onDestroy() {
        try {
            unregisterReceiver(screenReceiver)
        } catch (e: IllegalArgumentException) {
            // not registered
        }
        if (Bridge.current === bridge) Bridge.current = null
        ui.destroy()
        site.destroy()
        io.shutdown()
        super.onDestroy()
    }

    @Suppress("OVERRIDE_DEPRECATION", "DEPRECATION")
    override fun onBackPressed() {
        // Back is handled by the web app (dispatchKeyEvent); never close the home screen
    }

    // ------------------------------------------------------------------ remote
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        val code = event.keyCode
        if (isSystemKey(code)) return super.dispatchKeyEvent(event)
        val name = KeyEvent.keyCodeToString(code)
        if (code in OK_KEYS) {
            when (event.action) {
                KeyEvent.ACTION_DOWN -> if (event.repeatCount == 0) {
                    okKey = name
                    okLongSent = false
                    main.postDelayed(okLong, LONG_PRESS_MS)
                }
                KeyEvent.ACTION_UP -> {
                    main.removeCallbacks(okLong)
                    if (okKey == name && !okLongSent) bridge.key(name, 0, false)
                    okKey = null
                }
            }
            return true
        }
        if (event.action == KeyEvent.ACTION_DOWN) bridge.key(name, event.repeatCount, false)
        return true // everything else belongs to LampLauncher (so the pages never move focus)
    }

    // ------------------------------------------------------- Bridge.Host (main thread)
    override fun initMessage(): JSONObject {
        val power = getSystemService(Context.POWER_SERVICE) as PowerManager
        return JSONObject()
            .put("state", readState() ?: JSONObject.NULL)
            .put("apps", JSONArray()) // sent separately: loading icons takes a moment
            .put("info", deviceInfo())
            .put("interactive", power.isInteractive)
            .put("foreground", started)
            .put("wake", (application as LampLauncherApp).takeWake())
    }

    override fun saveState(json: String) {
        io.execute {
            try {
                val tmp = File(filesDir, "state.json.tmp")
                tmp.writeText(json)
                if (!tmp.renameTo(stateFile)) Log.w(TAG, "couldn't save state")
            } catch (e: Exception) {
                Log.w(TAG, "saving state failed: $e")
            }
        }
    }

    private fun readState(): String? = try {
        if (stateFile.isFile) stateFile.readText() else null
    } catch (e: Exception) {
        Log.w(TAG, "reading state failed: $e")
        null
    }

    override fun setKeepScreenOn(on: Boolean) {
        if (on) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }

    /** Plays a cam in the YouTube app, which picks the best quality the TV can show. */
    override fun openYouTube(url: String) {
        val uri = Uri.parse(url)
        val host = uri.host ?: ""
        if (uri.scheme != "https" || !(host == "youtube.com" || host.endsWith(".youtube.com"))) {
            Log.w(TAG, "not a YouTube link: $url")
            return
        }
        for (pkg in YOUTUBE_APPS) {
            val intent = Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            if (pkg != null) intent.setPackage(pkg)
            try {
                startActivity(intent)
                Log.i(TAG, "opened $url in ${pkg ?: "the default app"}")
                return
            } catch (e: ActivityNotFoundException) {
                // not installed: try the next one
            } catch (e: SecurityException) {
                Log.w(TAG, "not allowed to open ${pkg ?: "the link"}: $e")
            }
        }
        bridge.toast("Couldn't open the YouTube app. Is it installed?")
    }

    override fun showSite(url: String?) {
        if (url == null || !(url.startsWith("https://") || url.startsWith("http://"))) {
            site.visibility = View.GONE
            site.loadUrl("about:blank")
            return
        }
        site.visibility = View.VISIBLE
        site.loadUrl(url)
    }

    override fun siteEval(js: String) {
        if (site.visibility == View.VISIBLE) site.evaluateJavascript(js, null)
    }

    private fun injectSiteHelper(view: WebView) {
        val helper = siteHelper ?: origin.open("js/site-helper.js")?.use { it.readBytes().toString(Charsets.UTF_8) }
        siteHelper = helper
        if (helper != null) view.evaluateJavascript(helper, null)
    }

    override fun launchApp(id: String) {
        val intent = if (id == "@settings") {
            Intent(Settings.ACTION_SETTINGS)
        } else {
            packageManager.getLeanbackLaunchIntentForPackage(id) ?: packageManager.getLaunchIntentForPackage(id)
        }
        if (intent == null) {
            Log.w(TAG, "no way to open $id")
            return
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
            startActivity(intent)
        } catch (e: ActivityNotFoundException) {
            Log.w(TAG, "opening $id failed: $e")
        }
    }

    /** Turns the screen (and, through HDMI-CEC, the TV) on, e.g. from the cam manager. */
    @Suppress("DEPRECATION")
    override fun wakeScreen() {
        val power = getSystemService(Context.POWER_SERVICE) as PowerManager
        if (power.isInteractive) return
        val lock = power.newWakeLock(
            PowerManager.SCREEN_BRIGHT_WAKE_LOCK or PowerManager.ACQUIRE_CAUSES_WAKEUP, "lamplauncher:wake",
        )
        lock.acquire(10_000L)
    }

    // ------------------------------------------------------------------ helpers
    private fun refreshApps() {
        io.execute {
            val apps = try {
                AppList.load(this)
            } catch (e: Exception) {
                Log.w(TAG, "listing apps failed: $e")
                return@execute
            }
            main.post { bridge.apps(apps) }
        }
    }

    private fun isDefaultHome(): Boolean {
        val home = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
        val info = packageManager.resolveActivity(home, PackageManager.MATCH_DEFAULT_ONLY)
        return info?.activityInfo?.packageName == packageName
    }

    private fun localAddress(): String? = try {
        NetworkInterface.getNetworkInterfaces().toList()
            .filter { it.isUp && !it.isLoopback }
            .flatMap { it.inetAddresses.toList() }
            .firstOrNull { it is Inet4Address && it.isSiteLocalAddress }
            ?.hostAddress
    } catch (e: Exception) {
        null
    }

    private fun deviceInfo(): JSONObject {
        val ip = localAddress()
        val version = try {
            packageManager.getPackageInfo(packageName, 0).versionName
        } catch (e: PackageManager.NameNotFoundException) {
            null
        }
        val component = "$packageName/${MainActivity::class.java.name}"
        return JSONObject()
            .put("adminUrl", if (ip != null) "http://$ip:${AdminServer.PORT}/admin" else JSONObject.NULL)
            .put("isHome", isDefaultHome())
            .put("version", version ?: "?")
            .put("homeCommands", JSONArray(listOf(
                "adb shell cmd package set-home-activity $component",
                "adb shell pm disable-user --user 0 com.google.android.apps.tv.launcherx",
                "adb shell pm disable-user --user 0 com.google.android.tungsten.setupwraith",
            )))
    }
}
