package com.lamplauncher.tv

import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.WebMessage
import android.webkit.WebMessagePort
import android.webkit.WebView
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import java.util.concurrent.atomic.AtomicInteger

/**
 * The link between the Android app and LampLauncher's web app.
 *
 * A WebMessage channel whose page end is posted only to LampLauncher's own origin, so
 * nothing else loaded in the WebView (like YouTube's player frames) can use it.
 * Messages are JSON strings: see web/js/platform.js for the other side.
 */
class Bridge(private val host: Host, private val web: WebView) {
    /** What the web app can ask the device to do. Always called on the main thread. */
    interface Host {
        fun initMessage(): JSONObject
        fun saveState(json: String)
        fun setKeepScreenOn(on: Boolean)
        fun openYouTube(url: String)
        fun showSite(url: String?)
        fun siteEval(js: String)
        fun launchApp(id: String)
        fun wakeScreen()
    }

    data class ApiResult(val status: Int, val body: String)

    companion object {
        /** The bridge of the running activity, for the cam manager server. */
        @Volatile
        var current: Bridge? = null
        private const val CONNECT_RETRIES = 5
        private const val CONNECT_RETRY_MS = 3000L
        private const val API_TIMEOUT_S = 15L
    }

    private val main = Handler(Looper.getMainLooper())
    private var port: WebMessagePort? = null
    private var greeted = false
    private var tries = 0

    @Volatile
    private var ready = false
    private val queue = ArrayList<JSONObject>() // events between init and ready
    private val pending = ConcurrentHashMap<Int, CompletableFuture<ApiResult>>()
    private val ids = AtomicInteger(1)

    private val retry = Runnable {
        if (!greeted && tries < CONNECT_RETRIES) connect()
    }

    /** Hands the page a fresh channel. Call on the main thread once our page has loaded. */
    fun connect() {
        main.removeCallbacks(retry)
        port?.close()
        greeted = false
        ready = false
        tries++
        val channel = web.createWebMessageChannel()
        val mine = channel[0]
        mine.setWebMessageCallback(object : WebMessagePort.WebMessageCallback() {
            override fun onMessage(p: WebMessagePort, message: WebMessage) {
                if (p === port) onMessage(message.data ?: return)
            }
        }, main)
        port = mine
        web.postWebMessage(WebMessage("lamplauncher-port", arrayOf(channel[1])), Uri.parse(LocalOrigin.ORIGIN))
        // the page may not have been listening yet: try again if it doesn't say hello
        main.postDelayed(retry, CONNECT_RETRY_MS)
    }

    fun pageGone() {
        main.removeCallbacks(retry)
        port?.close()
        port = null
        greeted = false
        ready = false
        tries = 0
    }

    private fun send(msg: JSONObject) {
        val p = port ?: return
        try {
            p.postMessage(WebMessage(msg.toString()))
        } catch (e: IllegalStateException) {
            Log.w(TAG, "page channel closed: $e")
        }
    }

    /** Sends an event now if the app is listening, or once it is. */
    private fun event(msg: JSONObject) {
        main.post {
            if (ready) send(msg) else if (greeted) queue.add(msg)
            // before the page has said hello its init message carries the current state
        }
    }

    // ---------------------------------------------------------------- to the page
    fun key(name: String, repeat: Int, long: Boolean) {
        if (!ready) return
        event(JSONObject().put("t", "key").put("key", name).put("repeat", repeat).put("long", long))
    }

    fun life(ev: String) = event(JSONObject().put("t", "life").put("ev", ev))

    fun apps(apps: JSONArray) = event(JSONObject().put("t", "apps").put("apps", apps))

    fun info(info: JSONObject) = event(JSONObject().put("t", "info").put("info", info))

    /** A short message on the TV screen. */
    fun toast(text: String) = event(JSONObject().put("t", "toast").put("text", text))

    /** Relays a cam manager request to the web app and waits for the answer (any thread but main). */
    fun api(method: String, path: String, body: String): ApiResult {
        if (!ready) return ApiResult(503, """{"error":"LampLauncher is starting up, try again in a moment"}""")
        val id = ids.getAndIncrement()
        val future = CompletableFuture<ApiResult>()
        pending[id] = future
        main.post {
            send(JSONObject().put("t", "api").put("id", id).put("method", method).put("path", path).put("body", body))
        }
        return try {
            future.get(API_TIMEOUT_S, TimeUnit.SECONDS)
        } catch (e: TimeoutException) {
            ApiResult(504, """{"error":"LampLauncher didn't answer"}""")
        } finally {
            pending.remove(id)
        }
    }

    // -------------------------------------------------------------- from the page
    private fun onMessage(data: String) {
        val m = try {
            JSONObject(data)
        } catch (e: JSONException) {
            return
        }
        when (m.optString("t")) {
            "hello" -> {
                greeted = true
                tries = 0
                main.removeCallbacks(retry)
                queue.clear()
                send(host.initMessage().put("t", "init"))
            }
            "ready" -> {
                ready = true
                queue.forEach { send(it) }
                queue.clear()
            }
            "save" -> host.saveState(m.optString("data"))
            "keepScreenOn" -> host.setKeepScreenOn(m.optBoolean("on"))
            "youtube" -> host.openYouTube(m.optString("url"))
            "site" -> host.showSite(if (m.isNull("url")) null else m.optString("url"))
            "siteEval" -> host.siteEval(m.optString("js"))
            "launch" -> host.launchApp(m.optString("id"))
            "wakeScreen" -> host.wakeScreen()
            "apiReply" -> pending[m.optInt("id")]?.complete(ApiResult(m.optInt("status", 500), m.optString("body", "{}")))
            "log" -> {
                val text = "web: " + m.optString("msg")
                when (m.optString("level")) {
                    "error" -> Log.e(TAG, text)
                    "warn" -> Log.w(TAG, text)
                    else -> Log.i(TAG, text)
                }
            }
        }
    }
}
