package com.lamplauncher.tv

import android.util.Log
import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketException
import java.util.concurrent.Executors

/**
 * The phone-friendly cam manager at http://<box>:8686/admin.
 *
 * Serves the admin page from the app's assets and relays /api requests to the
 * web app (which owns all state) through the [Bridge]. Deliberately tiny: one
 * request per connection, small bodies, no keep-alive.
 */
class AdminServer(private val origin: LocalOrigin, val port: Int = PORT) {
    companion object {
        const val PORT = 8686
        private const val MAX_BODY = 1024 * 1024
        private const val MAX_LINE = 16 * 1024
    }

    private val pool = Executors.newFixedThreadPool(4)
    @Volatile
    private var server: ServerSocket? = null

    fun start() {
        if (server != null) return
        Thread({ serve() }, "lamplauncher-admin").apply { isDaemon = true }.start()
    }

    private fun serve() {
        var delay = 2000L
        while (true) {
            try {
                ServerSocket().use { s ->
                    s.reuseAddress = true
                    s.bind(InetSocketAddress(port))
                    server = s
                    Log.i(TAG, "cam manager listening on port $port")
                    delay = 2000L
                    while (true) {
                        val socket = s.accept()
                        pool.execute { handle(socket) }
                    }
                }
            } catch (e: IOException) {
                Log.w(TAG, "cam manager server: $e (retrying)")
                server = null
                Thread.sleep(delay)
                delay = (delay * 2).coerceAtMost(60_000L)
            }
        }
    }

    private class Request(val method: String, val target: String, val body: String)

    private class Response(val status: Int, val type: String, val body: ByteArray, val extra: Map<String, String> = emptyMap())

    private fun handle(socket: Socket) {
        socket.use {
            try {
                it.soTimeout = 20_000
                val input = BufferedInputStream(it.getInputStream())
                val request = read(input) ?: return
                write(it.getOutputStream(), route(request))
            } catch (e: SocketException) {
                // client went away
            } catch (e: IOException) {
                Log.w(TAG, "cam manager request failed: $e")
            }
        }
    }

    private fun readLine(input: InputStream): String? {
        val out = ByteArrayOutputStream()
        while (true) {
            val b = input.read()
            if (b < 0) return if (out.size() == 0) null else out.toString("ISO-8859-1")
            if (b == '\n'.code) return out.toString("ISO-8859-1").trimEnd('\r')
            out.write(b)
            if (out.size() > MAX_LINE) throw IOException("header line too long")
        }
    }

    private fun read(input: InputStream): Request? {
        val line = readLine(input) ?: return null
        val parts = line.split(" ")
        if (parts.size < 2) return null
        var length = 0
        while (true) {
            val header = readLine(input) ?: break
            if (header.isEmpty()) break
            val colon = header.indexOf(':')
            if (colon > 0 && header.substring(0, colon).trim().equals("Content-Length", ignoreCase = true)) {
                length = header.substring(colon + 1).trim().toIntOrNull() ?: 0
            }
        }
        if (length < 0 || length > MAX_BODY) throw IOException("body too large")
        val body = ByteArray(length)
        var read = 0
        while (read < length) {
            val n = input.read(body, read, length - read)
            if (n < 0) break
            read += n
        }
        return Request(parts[0].uppercase(), parts[1], String(body, 0, read, Charsets.UTF_8))
    }

    private fun json(status: Int, body: String) = Response(status, "application/json; charset=utf-8", body.toByteArray())

    private fun route(r: Request): Response {
        val path = r.target.substringBefore('?')
        if (path.startsWith("/api/")) {
            val bridge = Bridge.current ?: return json(503, """{"error":"LampLauncher isn't running"}""")
            val result = bridge.api(r.method, r.target, r.body)
            return json(result.status, result.body)
        }
        if (r.method != "GET") return json(405, """{"error":"method not allowed"}""")
        if (path == "/" || path == "/admin/") return Response(302, "text/plain", ByteArray(0), mapOf("Location" to "/admin"))
        val file = if (path == "/admin") "admin.html" else path.trimStart('/')
        // the cam manager only needs its page, scripts and styles
        if (!(file == "admin.html" || file.startsWith("js/") || file.startsWith("css/"))) {
            return json(404, """{"error":"not found"}""")
        }
        val stream = origin.open(file) ?: return json(404, """{"error":"not found"}""")
        return Response(200, LocalOrigin.mimeType(file) + "; charset=utf-8", stream.use { it.readBytes() })
    }

    private fun write(out: OutputStream, r: Response) {
        val reason = when (r.status) {
            200 -> "OK"
            302 -> "Found"
            400 -> "Bad Request"
            404 -> "Not Found"
            405 -> "Method Not Allowed"
            503 -> "Service Unavailable"
            504 -> "Gateway Timeout"
            else -> "Status"
        }
        val head = StringBuilder()
            .append("HTTP/1.1 ${r.status} $reason\r\n")
            .append("Content-Type: ${r.type}\r\n")
            .append("Content-Length: ${r.body.size}\r\n")
            .append("Cache-Control: no-store\r\n")
            .append("Connection: close\r\n")
        r.extra.forEach { (k, v) -> head.append("$k: $v\r\n") }
        head.append("\r\n")
        out.write(head.toString().toByteArray(Charsets.ISO_8859_1))
        out.write(r.body)
        out.flush()
    }
}
