package com.familyexpense.tracker.update

import android.app.DownloadManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.Settings
import java.io.File

/**
 * Fetches a new APK and hands it to Android's installer.
 *
 * DownloadManager rather than our own HTTP: it survives the app being closed,
 * shows the familiar download notification, and -- the reason it is worth it
 * here -- gives back a content:// URI the installer can already read, so there
 * is no FileProvider to configure and no file permissions to get wrong.
 *
 * Installing is still the person's decision. Android will not let it be
 * otherwise, and for an app that reads bank messages that is the right shape:
 * nothing replaces itself behind their back.
 */
class ApkInstaller(private val context: Context) {

    private val downloads
        get() = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager

    /**
     * True when this app is allowed to start an install. Android 8 made it a
     * per-app permission the user grants in Settings, and there is no way to
     * request it inline.
     */
    fun canInstall(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.O ||
            context.packageManager.canRequestPackageInstalls()

    fun openInstallPermissionSettings() {
        context.startActivity(
            Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES)
                .setData(Uri.parse("package:${context.packageName}"))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        )
    }

    /** @return the DownloadManager id, to match against the completion broadcast. */
    fun download(build: LatestBuild): Long {
        // DownloadManager does not overwrite. Left alone it writes
        // BudgetPadmanabham-update-1.apk, then -2, and a phone quietly fills up
        // with 14MB copies of an app it already has.
        File(context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), FILE_NAME).delete()

        val request = DownloadManager.Request(Uri.parse(build.url))
            .setTitle("Budget Padmanabham ${build.versionName}")
            .setDescription("Downloading the update")
            .setMimeType(APK_MIME)
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            .setDestinationInExternalFilesDir(context, Environment.DIRECTORY_DOWNLOADS, FILE_NAME)
        return downloads.enqueue(request)
    }

    /** @return false when the download failed or was cancelled. */
    fun install(downloadId: Long): Boolean {
        val uri = downloads.getUriForDownloadedFile(downloadId) ?: return false
        context.startActivity(
            Intent(Intent.ACTION_VIEW)
                .setDataAndType(uri, APK_MIME)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                // Started from the application context, so it needs its own task.
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        )
        return true
    }

    private companion object {
        const val APK_MIME = "application/vnd.android.package-archive"
        const val FILE_NAME = "BudgetPadmanabham-update.apk"
    }
}
