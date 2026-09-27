package com.familyexpense.tracker.auth

import android.content.Context
import android.net.Uri
import androidx.browser.customtabs.CustomTabsIntent
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.familyexpense.tracker.backend.SupabaseClient
import kotlinx.coroutines.flow.first

private val Context.authStore by preferencesDataStore("auth")

/**
 * Google sign-in, reusing the web app's existing OAuth setup.
 *
 * The app opens Supabase's authorize URL in a Chrome Custom Tab. Google
 * authenticates, Supabase completes the exchange server-side with the SAME
 * Google client the web app uses, then redirects to budgetpadmanabham://auth.
 *
 * Doing it this way means there is no Android OAuth client to register and
 * nothing bound to the signing key's SHA-1 -- which would otherwise break
 * sign-in for everyone the moment the release keystore changed.
 *
 * A Custom Tab, not a WebView: the user can see the real address bar, and
 * credentials are never typed into a surface this app controls.
 */
class AuthManager(private val context: Context, private val api: SupabaseClient) {

    private val accessKey = stringPreferencesKey("access_token")
    private val refreshKey = stringPreferencesKey("refresh_token")

    fun launchSignIn() {
        CustomTabsIntent.Builder()
            .setShowTitle(true)
            .build()
            .launchUrl(context, Uri.parse(api.googleSignInUrl()))
    }

    /**
     * Supabase returns tokens in the URL FRAGMENT, not the query string --
     * budgetpadmanabham://auth#access_token=...&refresh_token=... -- because a
     * fragment is never sent to a server. Reading intent.data.query here would
     * silently find nothing.
     */
    fun tokensFromRedirect(uri: Uri?): Pair<String, String>? {
        val fragment = uri?.fragment ?: return null
        val parts = fragment.split("&").mapNotNull {
            val kv = it.split("=", limit = 2)
            if (kv.size == 2) kv[0] to Uri.decode(kv[1]) else null
        }.toMap()
        val access = parts["access_token"] ?: return null
        val refresh = parts["refresh_token"] ?: return null
        return access to refresh
    }

    suspend fun persist(accessToken: String, refreshToken: String) {
        context.authStore.edit {
            it[accessKey] = accessToken
            it[refreshKey] = refreshToken
        }
    }

    suspend fun storedRefreshToken(): String? =
        context.authStore.data.first()[refreshKey]

    suspend fun storedAccessToken(): String? =
        context.authStore.data.first()[accessKey]

    suspend fun signOut() {
        context.authStore.edit { it.clear() }
    }

    /** Access tokens expire hourly; the refresh token is what survives a restart. */
    suspend fun restore(): Pair<String, String>? {
        val refresh = storedRefreshToken() ?: return null
        val fresh = api.exchangeRefreshToken(refresh) ?: return null
        persist(fresh.accessToken, fresh.refreshToken)
        return fresh.accessToken to fresh.refreshToken
    }
}
