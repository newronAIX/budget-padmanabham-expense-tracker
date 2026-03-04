package com.familyexpense.tracker.data

import com.familyexpense.tracker.domain.Category
import com.familyexpense.tracker.domain.CategoryScope
import com.familyexpense.tracker.domain.Expense
import com.familyexpense.tracker.domain.Family
import com.familyexpense.tracker.domain.FamilyInvite
import com.familyexpense.tracker.domain.FamilyMember
import com.familyexpense.tracker.domain.Income
import com.familyexpense.tracker.domain.Profile
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.engine.android.Android
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.parameter
import io.ktor.client.request.patch
import io.ktor.client.request.post
import io.ktor.client.request.delete
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.contentType
import io.ktor.serialization.kotlinx.json.json
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

class SupabaseApi(
    private val supabaseUrl: String,
    private val anonKey: String
) {
    private val json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
    }

    private val client = HttpClient(Android) {
        install(ContentNegotiation) {
            json(json)
        }
    }

    suspend fun signUp(email: String, password: String, fullName: String): AuthResponse {
        return client.post("$supabaseUrl/auth/v1/signup") {
            header("apikey", anonKey)
            contentType(ContentType.Application.Json)
            setBody(SignUpRequest(email = email, password = password, data = mapOf("full_name" to fullName)))
        }.body()
    }

    suspend fun signIn(email: String, password: String): AuthResponse {
        return client.post("$supabaseUrl/auth/v1/token") {
            parameter("grant_type", "password")
            header("apikey", anonKey)
            contentType(ContentType.Application.Json)
            setBody(SignInRequest(email = email, password = password))
        }.body()
    }

    suspend fun refreshSession(refreshToken: String): AuthResponse {
        return client.post("$supabaseUrl/auth/v1/token") {
            parameter("grant_type", "refresh_token")
            header("apikey", anonKey)
            contentType(ContentType.Application.Json)
            setBody(RefreshSessionRequest(refreshToken = refreshToken))
        }.body()
    }

    suspend fun upsertProfile(profile: Profile, accessToken: String) {
        client.post("$supabaseUrl/rest/v1/profiles") {
            addRestHeaders(accessToken)
            header("Prefer", "resolution=merge-duplicates")
            parameter("on_conflict", "id")
            contentType(ContentType.Application.Json)
            setBody(profile)
        }
    }

    suspend fun createFamily(name: String, ownerId: String, currencyCode: String, accessToken: String): Family {
        val rows = client.post("$supabaseUrl/rest/v1/families") {
            addRestHeaders(accessToken)
            header("Prefer", "return=representation")
            contentType(ContentType.Application.Json)
            setBody(FamilyInsert(name = name, ownerId = ownerId, currencyCode = currencyCode))
        }.body<List<Family>>()
        return rows.first()
    }

    suspend fun addFamilyMember(familyId: String, userId: String, role: String, displayName: String?, accessToken: String): FamilyMember {
        val rows = client.post("$supabaseUrl/rest/v1/family_members") {
            addRestHeaders(accessToken)
            header("Prefer", "return=representation")
            contentType(ContentType.Application.Json)
            setBody(FamilyMemberInsert(familyId = familyId, userId = userId, role = role, displayName = displayName))
        }.body<List<FamilyMember>>()
        return rows.first()
    }

    suspend fun deleteFamilyMember(memberId: String, familyId: String, accessToken: String) {
        client.delete("$supabaseUrl/rest/v1/family_members") {
            addRestHeaders(accessToken)
            parameter("id", "eq.$memberId")
            parameter("family_id", "eq.$familyId")
        }
    }

    suspend fun getUserFamilyMemberships(userId: String, accessToken: String): List<FamilyMember> {
        return client.get("$supabaseUrl/rest/v1/family_members") {
            addRestHeaders(accessToken)
            parameter("select", "*")
            parameter("user_id", "eq.$userId")
        }.body()
    }

    suspend fun getFamily(familyId: String, accessToken: String): Family? {
        val rows = client.get("$supabaseUrl/rest/v1/families") {
            addRestHeaders(accessToken)
            parameter("select", "*")
            parameter("id", "eq.$familyId")
            parameter("limit", 1)
        }.body<List<Family>>()
        return rows.firstOrNull()
    }

    suspend fun getFamilyMembers(familyId: String, accessToken: String): List<FamilyMember> {
        return client.get("$supabaseUrl/rest/v1/family_members") {
            addRestHeaders(accessToken)
            parameter("select", "*")
            parameter("family_id", "eq.$familyId")
        }.body()
    }

    suspend fun getCategories(familyId: String, accessToken: String): List<Category> {
        return client.get("$supabaseUrl/rest/v1/categories") {
            addRestHeaders(accessToken)
            parameter("select", "*")
            parameter("family_id", "eq.$familyId")
            parameter("order", "created_at.desc")
        }.body()
    }

    suspend fun createCategory(
        familyId: String,
        name: String,
        scope: CategoryScope,
        createdBy: String,
        accessToken: String
    ): Category {
        val rows = client.post("$supabaseUrl/rest/v1/categories") {
            addRestHeaders(accessToken)
            header("Prefer", "return=representation")
            contentType(ContentType.Application.Json)
            setBody(CategoryInsert(familyId = familyId, name = name, scope = scope, createdBy = createdBy))
        }.body<List<Category>>()
        return rows.first()
    }

    suspend fun getExpenses(familyId: String, accessToken: String): List<Expense> {
        return client.get("$supabaseUrl/rest/v1/expense_view") {
            addRestHeaders(accessToken)
            parameter("select", "*")
            parameter("family_id", "eq.$familyId")
            parameter("order", "spent_at.desc")
        }.body()
    }

    suspend fun createExpense(
        familyId: String,
        name: String,
        categoryId: String?,
        amount: Double,
        spentBy: String,
        notes: String?,
        accessToken: String
    ): Expense {
        val rows = client.post("$supabaseUrl/rest/v1/expenses") {
            addRestHeaders(accessToken)
            header("Prefer", "return=representation")
            contentType(ContentType.Application.Json)
            setBody(
                ExpenseInsert(
                    familyId = familyId,
                    name = name,
                    categoryId = categoryId,
                    amount = amount,
                    spentBy = spentBy,
                    notes = notes
                )
            )
        }.body<List<Expense>>()
        return rows.first()
    }

    suspend fun updateExpense(
        expenseId: String,
        name: String,
        categoryId: String?,
        amount: Double,
        notes: String?,
        accessToken: String
    ): Expense {
        val rows = client.patch("$supabaseUrl/rest/v1/expenses") {
            addRestHeaders(accessToken)
            header("Prefer", "return=representation")
            contentType(ContentType.Application.Json)
            setBody(
                ExpenseUpdate(
                    name = name,
                    categoryId = categoryId,
                    amount = amount,
                    notes = notes
                )
            )
            parameter("id", "eq.$expenseId")
        }.body<List<Expense>>()
        return rows.first()
    }

    suspend fun deleteExpense(expenseId: String, accessToken: String) {
        client.delete("$supabaseUrl/rest/v1/expenses") {
            addRestHeaders(accessToken)
            parameter("id", "eq.$expenseId")
        }
    }

    suspend fun getIncomes(familyId: String, accessToken: String): List<Income> {
        return try {
            client.get("$supabaseUrl/rest/v1/income_view") {
                addRestHeaders(accessToken)
                parameter("select", "*")
                parameter("family_id", "eq.$familyId")
                parameter("order", "created_at.desc")
            }.body()
        } catch (_: Throwable) {
            // Fallback for projects where income_view hasn't been created yet.
            client.get("$supabaseUrl/rest/v1/incomes") {
                addRestHeaders(accessToken)
                parameter("select", "*")
                parameter("family_id", "eq.$familyId")
                parameter("order", "created_at.desc")
            }.body()
        }
    }

    suspend fun createIncome(
        familyId: String,
        title: String,
        categoryId: String?,
        amount: Double,
        dayOfMonth: Int,
        accessToken: String
    ): Income {
        val rows = client.post("$supabaseUrl/rest/v1/incomes") {
            addRestHeaders(accessToken)
            header("Prefer", "return=representation")
            contentType(ContentType.Application.Json)
            setBody(
                IncomeInsert(
                    familyId = familyId,
                    title = title,
                    categoryId = categoryId,
                    amount = amount,
                    dayOfMonth = dayOfMonth
                )
            )
        }.body<List<Income>>()
        return rows.first()
    }

    suspend fun updateIncome(
        incomeId: String,
        title: String,
        categoryId: String?,
        amount: Double,
        dayOfMonth: Int,
        isActive: Boolean,
        accessToken: String
    ): Income {
        val rows = client.patch("$supabaseUrl/rest/v1/incomes") {
            addRestHeaders(accessToken)
            header("Prefer", "return=representation")
            contentType(ContentType.Application.Json)
            setBody(
                IncomeUpdate(
                    title = title,
                    categoryId = categoryId,
                    amount = amount,
                    dayOfMonth = dayOfMonth,
                    isActive = isActive
                )
            )
            parameter("id", "eq.$incomeId")
        }.body<List<Income>>()
        return rows.first()
    }

    suspend fun createInvite(
        familyId: String,
        invitedEmail: String,
        inviteCode: String,
        inviterId: String,
        currencyCode: String,
        accessToken: String
    ): FamilyInvite {
        val rows = client.post("$supabaseUrl/rest/v1/family_invites") {
            addRestHeaders(accessToken)
            header("Prefer", "return=representation")
            contentType(ContentType.Application.Json)
            setBody(
                FamilyInviteInsert(
                    familyId = familyId,
                    invitedEmail = invitedEmail,
                    inviteCode = inviteCode,
                    inviterId = inviterId,
                    currencyCode = currencyCode
                )
            )
        }.body<List<FamilyInvite>>()
        return rows.first()
    }

    suspend fun getInviteByCode(code: String, accessToken: String): FamilyInvite? {
        val rows = client.get("$supabaseUrl/rest/v1/family_invites") {
            addRestHeaders(accessToken)
            parameter("select", "*")
            parameter("invite_code", "eq.$code")
            parameter("status", "eq.PENDING")
            parameter("limit", 1)
        }.body<List<FamilyInvite>>()
        return rows.firstOrNull()
    }

    suspend fun markInviteAccepted(inviteId: String, accessToken: String) {
        client.patch("$supabaseUrl/rest/v1/family_invites") {
            addRestHeaders(accessToken)
            contentType(ContentType.Application.Json)
            setBody(InviteStatusUpdate(status = "ACCEPTED"))
            parameter("id", "eq.$inviteId")
        }
    }

    private fun io.ktor.client.request.HttpRequestBuilder.addRestHeaders(accessToken: String) {
        header("apikey", anonKey)
        header(HttpHeaders.Authorization, "Bearer $accessToken")
    }
}

@Serializable
data class SignUpRequest(
    val email: String,
    val password: String,
    val data: Map<String, String>
)

@Serializable
data class SignInRequest(
    val email: String,
    val password: String
)

@Serializable
data class RefreshSessionRequest(
    @SerialName("refresh_token") val refreshToken: String
)

@Serializable
data class AuthResponse(
    @SerialName("access_token") val accessToken: String? = null,
    @SerialName("refresh_token") val refreshToken: String? = null,
    val user: AuthUser? = null
)

@Serializable
data class AuthUser(
    val id: String,
    val email: String? = null
)

@Serializable
data class FamilyInsert(
    val name: String,
    @SerialName("owner_id") val ownerId: String,
    @SerialName("currency_code") val currencyCode: String
)

@Serializable
data class FamilyMemberInsert(
    @SerialName("family_id") val familyId: String,
    @SerialName("user_id") val userId: String,
    val role: String,
    @SerialName("display_name") val displayName: String?
)

@Serializable
data class CategoryInsert(
    @SerialName("family_id") val familyId: String,
    val name: String,
    val scope: CategoryScope,
    @SerialName("created_by") val createdBy: String
)

@Serializable
data class ExpenseInsert(
    @SerialName("family_id") val familyId: String,
    val name: String,
    @SerialName("category_id") val categoryId: String? = null,
    val amount: Double,
    @SerialName("spent_by") val spentBy: String,
    val notes: String? = null
)

@Serializable
data class ExpenseUpdate(
    val name: String,
    @SerialName("category_id") val categoryId: String? = null,
    val amount: Double,
    val notes: String? = null
)

@Serializable
data class IncomeInsert(
    @SerialName("family_id") val familyId: String,
    val title: String,
    @SerialName("category_id") val categoryId: String? = null,
    val amount: Double,
    @SerialName("day_of_month") val dayOfMonth: Int
)

@Serializable
data class IncomeUpdate(
    val title: String,
    @SerialName("category_id") val categoryId: String? = null,
    val amount: Double,
    @SerialName("day_of_month") val dayOfMonth: Int,
    @SerialName("is_active") val isActive: Boolean
)

@Serializable
data class FamilyInviteInsert(
    @SerialName("family_id") val familyId: String,
    @SerialName("invited_email") val invitedEmail: String,
    @SerialName("invite_code") val inviteCode: String,
    @SerialName("inviter_id") val inviterId: String,
    @SerialName("currency_code") val currencyCode: String
)

@Serializable
data class InviteStatusUpdate(
    val status: String
)
