package com.familyexpense.tracker.sms

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringSetPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.first

private val Context.seenStore by preferencesDataStore("sms_seen")

/**
 * Remembers which SMS have already been reviewed, so they are not offered twice.
 *
 * Stores ONLY one-way fingerprints -- never a sender, a body, or an amount. If
 * this file were read off the device it would disclose nothing about any
 * message; it can only answer "have I seen this exact one before".
 */
class SeenStore(private val context: Context) {

    private val key = stringSetPreferencesKey("fingerprints")
    /** Enough for years of alerts, and bounded so it cannot grow without limit. */
    private val cap = 5000

    suspend fun all(): Set<String> = context.seenStore.data.first()[key] ?: emptySet()

    suspend fun markSeen(fingerprints: Collection<String>) {
        if (fingerprints.isEmpty()) return
        context.seenStore.edit { prefs ->
            val merged = (prefs[key] ?: emptySet()) + fingerprints
            prefs[key] = if (merged.size <= cap) merged else merged.toList().takeLast(cap).toSet()
        }
    }
}
