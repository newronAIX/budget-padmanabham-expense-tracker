package com.familyexpense.tracker.backend

import com.familyexpense.tracker.BuildConfig
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.engine.android.Android
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.headers
import io.ktor.client.request.parameter
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.contentType
import io.ktor.http.isSuccess
import io.ktor.serialization.kotlinx.json.json
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject

/**
 * Minimal Supabase client: only what the SMS-capture app needs.
 *
 * Every read here is already constrained by RLS, so the queries do not re-filter
 * by family -- the database will not return another family's rows regardless of
 * what is asked for.
 */
class SupabaseClient(
    private val baseUrl: String = BuildConfig.SUPABASE_URL,
    private val anonKey: String = BuildConfig.SUPABASE_ANON_KEY
) {
    val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    private val http = HttpClient(Android) {
        install(ContentNegotiation) { json(json) }
        expectSuccess = false
    }

    /** The URL to open in a Custom Tab to begin Google sign-in. */
    fun googleSignInUrl(): String =
        "$baseUrl/auth/v1/authorize?provider=google&redirect_to=${BuildConfig.AUTH_REDIRECT}"

    suspend fun exchangeRefreshToken(refreshToken: String): TokenResponse? {
        val res = http.post("$baseUrl/auth/v1/token") {
            parameter("grant_type", "refresh_token")
            header("apikey", anonKey)
            contentType(ContentType.Application.Json)
            setBody(buildJsonObject { put("refresh_token", JsonPrimitive(refreshToken)) })
        }
        return if (res.status.isSuccess()) res.body() else null
    }

    suspend fun currentUser(accessToken: String): AuthUser? {
        val res = http.get("$baseUrl/auth/v1/user") { auth(accessToken) }
        return if (res.status.isSuccess()) res.body() else null
    }

    // ---- reads -------------------------------------------------------------

    suspend fun membership(accessToken: String): MembershipRow? =
        rest<List<MembershipRow>>(accessToken, "budget_family_users", "select=family_id,role&limit=1")
            ?.firstOrNull()

    suspend fun family(accessToken: String, familyId: String): FamilyRow? =
        rest<List<FamilyRow>>(accessToken, "budget_families", "select=*&id=eq.$familyId")
            ?.firstOrNull()

    suspend fun people(accessToken: String): List<PersonRow> =
        rest<List<PersonRow>>(accessToken, "budget_people", "select=*") ?: emptyList()

    suspend fun categories(accessToken: String): List<CategoryRow> =
        rest<List<CategoryRow>>(accessToken, "budget_categories", "select=*") ?: emptyList()

    suspend fun expenses(accessToken: String, limit: Int = 200): List<ExpenseRow> =
        rest<List<ExpenseRow>>(
            accessToken, "budget_expenses",
            "select=*&order=spent_on.desc,created_at.desc&limit=$limit"
        ) ?: emptyList()

    // ---- writes ------------------------------------------------------------

    /**
     * Inserts an expense. The plaintext columns carry the same decoys the web app
     * writes: the row must satisfy NOT NULL and amount > 0 without disclosing
     * anything, so the real values live only in encrypted_payload.
     */
    suspend fun insertExpense(accessToken: String, row: ExpenseRow): Result<Unit> {
        val res = http.post("$baseUrl/rest/v1/budget_expenses") {
            auth(accessToken)
            header("Prefer", "return=minimal")
            contentType(ContentType.Application.Json)
            setBody(listOf(row))
        }
        return if (res.status.isSuccess()) Result.success(Unit)
        else Result.failure(IllegalStateException(res.errorText()))
    }

    /**
     * Returns the family's KDF salt for a valid, unlocked invite code.
     *
     * Since the September fix this returns the salt ONLY. It used to also return
     * encryption_check, the ciphertext verifier, which let anyone with a code
     * mount an offline dictionary attack on the family password. Verification
     * now happens server side inside join_budget_family.
     */
    suspend fun inviteSalt(accessToken: String, inviteCode: String): String? {
        val res = http.post("$baseUrl/rest/v1/rpc/get_budget_invite_security") {
            auth(accessToken)
            contentType(ContentType.Application.Json)
            setBody(buildJsonObject { put("invite_code_input", JsonPrimitive(inviteCode)) })
        }
        if (!res.status.isSuccess()) return null
        val rows = runCatching { json.decodeFromString<List<InviteSecurityRow>>(res.bodyAsText()) }.getOrNull()
        return rows?.firstOrNull()?.encryptionSalt
    }

    suspend fun joinFamily(
        accessToken: String,
        inviteCode: String,
        displayName: String,
        keyFingerprint: String
    ): Result<String> {
        val res = http.post("$baseUrl/rest/v1/rpc/join_budget_family") {
            auth(accessToken)
            contentType(ContentType.Application.Json)
            setBody(buildJsonObject {
                put("invite_code_input", JsonPrimitive(inviteCode))
                put("display_name_input", JsonPrimitive(displayName))
                put("key_fingerprint_input", JsonPrimitive(keyFingerprint))
            })
        }
        val text = res.bodyAsText()
        return if (res.status.isSuccess()) Result.success(text.trim('"'))
        else Result.failure(IllegalStateException(res.errorText(text)))
    }

    // ---- plumbing ----------------------------------------------------------

    private suspend inline fun <reified T> rest(
        accessToken: String,
        table: String,
        query: String
    ): T? {
        val res = http.get("$baseUrl/rest/v1/$table?$query") { auth(accessToken) }
        return if (res.status.isSuccess()) res.body<T>() else null
    }

    private fun io.ktor.client.request.HttpRequestBuilder.auth(accessToken: String) {
        headers {
            append("apikey", anonKey)
            append("Authorization", "Bearer $accessToken")
        }
    }

    /** Surfaces Postgres's own message, which is what makes RLS failures debuggable. */
    private suspend fun HttpResponse.errorText(preloaded: String? = null): String {
        val body = preloaded ?: runCatching { bodyAsText() }.getOrNull().orEmpty()
        val message = runCatching {
            (json.parseToJsonElement(body) as? JsonObject)
                ?.get("message")?.let { (it as? JsonPrimitive)?.content }
        }.getOrNull()
        return message ?: "Request failed (${status.value})"
    }

    private fun kotlinx.serialization.json.JsonObjectBuilder.put(k: String, v: JsonPrimitive) {
        put(k, v as kotlinx.serialization.json.JsonElement)
    }
}
