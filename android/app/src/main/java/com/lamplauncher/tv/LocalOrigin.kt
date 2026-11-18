package com.lamplauncher.tv

import android.content.res.AssetManager
import android.net.Uri
import android.util.Log
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URI

/**
 * Serves LampLauncher's web app (the APK's assets, copied from web/) under a real https
 * origin. YouTube refuses embeds from pages without a proper origin/referrer
 * ("Error 153"), which a file:// page wouldn't have. The host name is the one
 * Android reserves for exactly this.
 *
 * Also answers /proxy?url=..., fetching YouTube channel pages for the web app,
 * which can't read them itself (cross-origin).
 */
class LocalOrigin(private val assets: AssetManager) {
    companion object {
        const val HOST = "appassets.androidplatform.net"
        const val ORIGIN = "https://$HOST"
        const val START_URL = "$ORIGIN/index.html?platform=android"
        private val PROXY_HOSTS = setOf("www.youtube.com", "youtube.com", "m.youtube.com")

        fun mimeType(path: String): String = when (path.substringAfterLast('.', "").lowercase()) {
            "html" -> "text/html"
            "js", "mjs" -> "text/javascript"
            "css" -> "text/css"
            "json" -> "application/json"
            "svg" -> "image/svg+xml"
            "png" -> "image/png"
            "jpg", "jpeg" -> "image/jpeg"
            "ico" -> "image/x-icon"
            "woff2" -> "font/woff2"
            else -> "application/octet-stream"
        }
    }

    /** For WebViewClient.shouldInterceptRequest; null lets other hosts go to the network. */
    fun handle(request: WebResourceRequest): WebResourceResponse? {
        val url = request.url
        if (url.host != HOST) return null
        if (request.method != "GET") return error(405, "Method Not Allowed")
        val path = url.path ?: "/"
        return if (path == "/proxy") proxy(url.getQueryParameter("url")) else asset(path)
    }

    /** Opens a web app file, or null if it doesn't exist (or tries to escape the assets). */
    fun open(path: String): InputStream? {
        val rel = path.trimStart('/').ifEmpty { "index.html" }
        if (rel.split('/').any { it == ".." }) return null
        return try {
            assets.open(rel)
        } catch (e: IOException) {
            null
        }
    }

    private fun asset(path: String): WebResourceResponse {
        val stream = open(path) ?: return error(404, "Not Found")
        val rel = path.trimStart('/').ifEmpty { "index.html" }
        return WebResourceResponse(mimeType(rel), "utf-8", 200, "OK", mapOf("Cache-Control" to "no-cache"), stream)
    }

    private fun proxy(target: String?): WebResourceResponse {
        val uri = target?.let { Uri.parse(it) }
        if (target == null || uri == null || uri.scheme != "https" || uri.host !in PROXY_HOSTS) {
            return error(403, "Forbidden")
        }
        return try {
            val body = Http.get(target)
            WebResourceResponse("text/html", "utf-8", 200, "OK", mapOf("Cache-Control" to "no-store"), ByteArrayInputStream(body))
        } catch (e: Exception) {
            Log.w(TAG, "proxy $target failed: $e")
            error(502, "Bad Gateway")
        }
    }

    private fun error(code: Int, reason: String) = WebResourceResponse(
        "text/plain", "utf-8", code, reason, mapOf("Cache-Control" to "no-store"),
        ByteArrayInputStream(reason.toByteArray()),
    )
}

/** Plain HTTPS GET, sized for YouTube channel pages. */
object Http {
    private const val MAX_BYTES = 8 * 1024 * 1024
    private const val USER_AGENT =
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36"

    fun get(url: String): ByteArray {
        val conn = URI(url).toURL().openConnection() as HttpURLConnection
        conn.connectTimeout = 10_000
        conn.readTimeout = 15_000
        conn.instanceFollowRedirects = true
        conn.setRequestProperty("User-Agent", USER_AGENT)
        conn.setRequestProperty("Accept-Language", "en-US,en;q=0.9")
        // skip the EU cookie-consent page if YouTube serves one
        conn.setRequestProperty("Cookie", "SOCS=CAI; CONSENT=YES+")
        try {
            val code = conn.responseCode
            if (code !in 200..299) throw IOException("HTTP $code")
            conn.inputStream.use { input ->
                val out = ByteArrayOutputStream()
                val buf = ByteArray(64 * 1024)
                while (true) {
                    val n = input.read(buf)
                    if (n < 0) break
                    out.write(buf, 0, n)
                    if (out.size() > MAX_BYTES) throw IOException("page too large")
                }
                return out.toByteArray()
            }
        } finally {
            conn.disconnect()
        }
    }
}

const val TAG = "LampLauncher"
