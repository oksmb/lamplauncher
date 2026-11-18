package com.lamplauncher.tv

import android.app.Application
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.PowerManager
import android.os.SystemClock

class LampLauncherApp : Application() {
    val origin: LocalOrigin by lazy { LocalOrigin(assets) }
    private val admin: AdminServer by lazy { AdminServer(origin) }
    private val screenLog by lazy { getSharedPreferences("screen", Context.MODE_PRIVATE) }

    /** Notes when the screen goes on and off, for [takeWake]; lives as long as the app. */
    private val screenReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            when (intent.action) {
                Intent.ACTION_SCREEN_ON -> recordScreen(true)
                Intent.ACTION_SCREEN_OFF -> recordScreen(false)
            }
        }
    }

    override fun onCreate() {
        super.onCreate()
        admin.start()
        val filter = IntentFilter().apply {
            addAction(Intent.ACTION_SCREEN_ON)
            addAction(Intent.ACTION_SCREEN_OFF)
        }
        if (Build.VERSION.SDK_INT >= 33) {
            registerReceiver(screenReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            registerReceiver(screenReceiver, filter)
        }
    }

    private fun recordScreen(on: Boolean) {
        screenLog.edit()
            .putBoolean("on", on)
            .putLong("elapsed", SystemClock.elapsedRealtime())
            .putLong("uptime", SystemClock.uptimeMillis())
            .apply()
    }

    /**
     * Has the box woken up since LampLauncher last saw the screen on? Then LampLauncher
     * starting is part of switching on, and the default cam should open. If not,
     * Android merely restarted it (e.g. Home after it was closed to free memory while
     * the YouTube app played), and the globe should show instead.
     *
     * Woken up: the box restarted, the screen was last seen going off, or the box
     * slept since (deep sleep stops [SystemClock.uptimeMillis] but not the real clock).
     * Answers each wake-up once.
     */
    fun takeWake(): Boolean {
        val elapsed = screenLog.getLong("elapsed", -1L)
        val now = SystemClock.elapsedRealtime()
        val rebooted = elapsed < 0 || elapsed > now
        val slept = !rebooted &&
            (now - elapsed) - (SystemClock.uptimeMillis() - screenLog.getLong("uptime", 0L)) > 60_000L
        val wake = rebooted || slept || !screenLog.getBoolean("on", false)
        recordScreen((getSystemService(Context.POWER_SERVICE) as PowerManager).isInteractive)
        return wake
    }
}
