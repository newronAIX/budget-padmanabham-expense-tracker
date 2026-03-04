package com.familyexpense.tracker.data

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

private val Context.dataStore by preferencesDataStore(name = "expense_tracker_prefs")

class AppPreferences(private val context: Context) {

    private val lastExpenseDateKey = stringPreferencesKey("last_expense_date")
    private val activeFamilyIdKey = stringPreferencesKey("active_family_id")
    private val accessTokenKey = stringPreferencesKey("access_token")
    private val refreshTokenKey = stringPreferencesKey("refresh_token")
    private val userIdKey = stringPreferencesKey("user_id")

    val lastExpenseDate: Flow<String?> = context.dataStore.data.map { it[lastExpenseDateKey] }

    val activeFamilyId: Flow<String?> = context.dataStore.data.map { it[activeFamilyIdKey] }
    val accessToken: Flow<String?> = context.dataStore.data.map { it[accessTokenKey] }
    val refreshToken: Flow<String?> = context.dataStore.data.map { it[refreshTokenKey] }
    val userId: Flow<String?> = context.dataStore.data.map { it[userIdKey] }

    suspend fun setLastExpenseDate(value: String) {
        context.dataStore.edit { it[lastExpenseDateKey] = value }
    }

    suspend fun setActiveFamilyId(value: String) {
        context.dataStore.edit { it[activeFamilyIdKey] = value }
    }

    suspend fun setSession(accessToken: String, refreshToken: String?, userId: String) {
        context.dataStore.edit { prefs ->
            prefs[accessTokenKey] = accessToken
            if (refreshToken != null) {
                prefs[refreshTokenKey] = refreshToken
            } else {
                prefs.remove(refreshTokenKey)
            }
            prefs[userIdKey] = userId
        }
    }

    suspend fun clearSessionScopedValues() {
        context.dataStore.edit { prefs ->
            prefs.remove(lastExpenseDateKey)
            prefs.remove(activeFamilyIdKey)
            prefs.remove(accessTokenKey)
            prefs.remove(refreshTokenKey)
            prefs.remove(userIdKey)
        }
    }
}
