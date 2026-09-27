package com.familyexpense.tracker.update

import com.familyexpense.tracker.BuildConfig
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.request.get
import io.ktor.client.statement.HttpResponse
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * What the site says the newest build is.
 *
 * [versionCode] is the only field that decides anything. Names are for people;
 * Android compares codes, and so does this.
 */
@Serializable
data class LatestBuild(
    @SerialName("versionCode") val versionCode: Int,
    @SerialName("versionName") val versionName: String,
    /** Absolute or site-relative path to the APK. */
    @SerialName("url") val url: String,
    /** One short line for the family, in plain words. */
    @SerialName("notes") val notes: String = ""
)

/**
 * A sideloaded app has no store behind it, so nothing tells it a new build
 * exists. This asks.
 *
 * Deliberately not silent-and-automatic: Android will not install an APK
 * without the person agreeing, so the honest design is a banner they can ignore
 * rather than a background download pretending it can finish the job.
 */
class UpdateChecker(
    private val http: HttpClient,
    private val siteUrl: String = BuildConfig.SITE_URL,
    private val installedVersionCode: Int = BuildConfig.VERSION_CODE
) {

    /**
     * Null when up to date, when the site cannot be reached, or when it says
     * something we do not understand. A failed update check must never be a
     * thing the family has to read about -- they came here to see their expenses.
     */
    suspend fun check(): LatestBuild? = runCatching {
        val response: HttpResponse = http.get("$siteUrl/$MANIFEST")
        val latest: LatestBuild = response.body()
        if (latest.versionCode > installedVersionCode) latest.absolute() else null
    }.getOrNull()

    private fun LatestBuild.absolute(): LatestBuild =
        if (url.startsWith("http")) this else copy(url = "$siteUrl/${url.trimStart('/')}")

    private companion object {
        const val MANIFEST = "android-latest.json"
    }
}
