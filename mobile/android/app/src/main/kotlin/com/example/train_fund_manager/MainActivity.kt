package com.example.train_fund_manager

import android.content.ContentValues
import android.content.ClipData
import android.content.Intent
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.Manifest
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    private data class SavedPdf(val uri: Uri, val name: String, val result: MethodChannel.Result)

    private var pendingPdf: SavedPdf? = null

    companion object {
        private const val PDF_CHANNEL = "downloaded_reports"
        private const val NOTIFICATION_PERMISSION_REQUEST = 701
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "train_fund_manager/downloads")
            .setMethodCallHandler { call, result ->
                if (call.method != "savePdf") {
                    result.notImplemented()
                    return@setMethodCallHandler
                }
                if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
                    result.error("UNSUPPORTED", "Direct downloads require Android 10 or later", null)
                    return@setMethodCallHandler
                }
                val name = call.argument<String>("name")
                val bytes = call.argument<ByteArray>("bytes")
                if (name == null || !name.matches(Regex("[A-Za-z0-9_-]{1,100}\\.pdf")) ||
                    bytes == null || bytes.isEmpty()) {
                    result.error("INVALID_PDF", "Invalid PDF download", null)
                    return@setMethodCallHandler
                }
                Thread {
                    var uri: android.net.Uri? = null
                    try {
                        val values = ContentValues().apply {
                            put(MediaStore.MediaColumns.DISPLAY_NAME, name)
                            put(MediaStore.MediaColumns.MIME_TYPE, "application/pdf")
                            put(MediaStore.MediaColumns.RELATIVE_PATH,
                                "${Environment.DIRECTORY_DOWNLOADS}/TrainFundManager")
                            put(MediaStore.MediaColumns.IS_PENDING, 1)
                        }
                        uri = contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                            ?: throw IllegalStateException("Could not create download")
                        contentResolver.openOutputStream(uri!!)?.use { it.write(bytes) }
                            ?: throw IllegalStateException("Could not write download")
                        val completed = ContentValues().apply {
                            put(MediaStore.MediaColumns.IS_PENDING, 0)
                        }
                        contentResolver.update(uri!!, completed, null, null)
                        val savedName = runCatching {
                            contentResolver.query(
                                uri!!, arrayOf(MediaStore.MediaColumns.DISPLAY_NAME), null, null, null
                            )?.use { cursor ->
                                if (cursor.moveToFirst()) cursor.getString(0) else name
                            } ?: name
                        }.getOrDefault(name)
                        val saved = SavedPdf(uri!!, savedName, result)
                        runOnUiThread { finishDownload(saved) }
                    } catch (error: Exception) {
                        uri?.let { runCatching { contentResolver.delete(it, null, null) } }
                        runOnUiThread { result.error("SAVE_FAILED", error.message, null) }
                    }
                }.start()
            }
    }

    private fun finishDownload(saved: SavedPdf) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) !=
                PackageManager.PERMISSION_GRANTED) {
            pendingPdf = saved
            requestPermissions(
                arrayOf(Manifest.permission.POST_NOTIFICATIONS),
                NOTIFICATION_PERMISSION_REQUEST
            )
            return
        }
        completeDownload(saved)
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != NOTIFICATION_PERMISSION_REQUEST) return
        val saved = pendingPdf ?: return
        pendingPdf = null
        completeDownload(saved)
    }

    private fun completeDownload(saved: SavedPdf) {
        val notified = postPdfNotification(saved)
        val opened = runCatching { startActivity(pdfViewIntent(saved.uri, saved.name)) }
            .isSuccess
        saved.result.success(
            mapOf(
                "filename" to saved.name,
                "opened" to opened,
                "notified" to notified
            )
        )
    }

    private fun pdfViewIntent(uri: Uri, name: String): Intent =
        Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/pdf")
            clipData = ClipData.newUri(contentResolver, name, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }

    private fun postPdfNotification(saved: SavedPdf): Boolean = runCatching {
        val manager = getSystemService(NotificationManager::class.java)
        if (!manager.areNotificationsEnabled()) return@runCatching false
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            manager.createNotificationChannel(
                NotificationChannel(
                    PDF_CHANNEL, "Downloaded reports", NotificationManager.IMPORTANCE_DEFAULT
                )
            )
            if (manager.getNotificationChannel(PDF_CHANNEL)?.importance ==
                NotificationManager.IMPORTANCE_NONE) return@runCatching false
        }
        val viewIntent = pdfViewIntent(saved.uri, saved.name).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        val notificationId = saved.uri.toString().hashCode()
        val openPdf = PendingIntent.getActivity(
            this,
            notificationId,
            viewIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val notification = Notification.Builder(this, PDF_CHANNEL)
            .setSmallIcon(android.R.drawable.stat_sys_download_done)
            .setContentTitle("PDF downloaded")
            .setContentText(saved.name)
            .setContentIntent(openPdf)
            .setAutoCancel(true)
            .setVisibility(Notification.VISIBILITY_PRIVATE)
            .build()
        manager.notify(notificationId, notification)
        true
    }.getOrDefault(false)
}
