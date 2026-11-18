package com.lamplauncher.tv

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.drawable.Drawable
import android.provider.Settings
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream

/**
 * The other apps on the box, for LampLauncher's "Apps" row. LampLauncher usually replaces the
 * Google TV home screen, so it has to offer a way into Settings and other apps.
 */
object AppList {
    private const val W = 320
    private const val H = 180

    fun load(context: Context): JSONArray {
        val pm = context.packageManager
        val out = JSONArray()
        out.put(entry("@settings", "Settings", settingsIcon(pm), banner = false))
        val seen = HashSet<String>()
        val found = ArrayList<JSONObject>()
        for (category in listOf(Intent.CATEGORY_LEANBACK_LAUNCHER, Intent.CATEGORY_LAUNCHER)) {
            val query = Intent(Intent.ACTION_MAIN).addCategory(category)
            for (info in pm.queryIntentActivities(query, 0)) {
                val app = info.activityInfo ?: continue
                val pkg = app.packageName
                if (pkg == context.packageName || !seen.add(pkg)) continue
                val label = info.loadLabel(pm).toString()
                val bannerDrawable = app.loadBanner(pm) ?: app.applicationInfo.loadBanner(pm)
                val drawable = bannerDrawable ?: info.loadIcon(pm)
                found.add(entry(pkg, label, drawable, banner = bannerDrawable != null))
            }
        }
        found.sortBy { it.optString("label").lowercase() }
        found.forEach { out.put(it) }
        return out
    }

    private fun settingsIcon(pm: PackageManager): Drawable? = try {
        pm.getActivityIcon(Intent(Settings.ACTION_SETTINGS))
    } catch (e: PackageManager.NameNotFoundException) {
        null
    }

    private fun entry(id: String, label: String, drawable: Drawable?, banner: Boolean): JSONObject {
        val o = JSONObject().put("id", id).put("label", label).put("banner", banner)
        if (drawable != null) {
            try {
                o.put("icon", toDataUrl(drawable, banner))
            } catch (e: RuntimeException) {
                // an odd drawable; the tile shows the name instead
            }
        }
        return o
    }

    /** Draws a TV banner (or an app icon centred on a tile) into a PNG data: URL. */
    private fun toDataUrl(d: Drawable, banner: Boolean): String {
        val bmp = Bitmap.createBitmap(W, H, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bmp)
        if (banner) {
            d.setBounds(0, 0, W, H)
        } else {
            canvas.drawColor(Color.rgb(0x2a, 0x26, 0x33))
            val size = 104
            val left = (W - size) / 2
            val top = (H - size) / 2 - 14
            d.setBounds(left, top, left + size, top + size)
        }
        d.draw(canvas)
        val bytes = ByteArrayOutputStream()
        bmp.compress(Bitmap.CompressFormat.PNG, 100, bytes)
        bmp.recycle()
        return "data:image/png;base64," + Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP)
    }
}
