package com.example.train_fund_manager

import android.content.ContentValues
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
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
                        runOnUiThread { result.success(savedName) }
                    } catch (error: Exception) {
                        uri?.let { runCatching { contentResolver.delete(it, null, null) } }
                        runOnUiThread { result.error("SAVE_FAILED", error.message, null) }
                    }
                }.start()
            }
    }
}
