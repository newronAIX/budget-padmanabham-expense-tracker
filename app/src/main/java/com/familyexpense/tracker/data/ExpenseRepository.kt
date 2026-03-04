package com.familyexpense.tracker.data

import android.content.Context
import com.familyexpense.tracker.BuildConfig
import com.familyexpense.tracker.domain.Category
import com.familyexpense.tracker.domain.CategoryScope
import com.familyexpense.tracker.domain.Expense
import com.familyexpense.tracker.domain.ExpenseDraft
import com.familyexpense.tracker.domain.Family
import com.familyexpense.tracker.domain.FamilyInvite
import com.familyexpense.tracker.domain.FamilyMember
import com.familyexpense.tracker.domain.Income
import com.familyexpense.tracker.domain.IncomeDraft
import com.familyexpense.tracker.domain.Profile
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withContext
import java.time.LocalDate

class ExpenseRepository(context: Context) {

    private val prefs = AppPreferences(context)
    private val crypto = ExpenseCrypto()
    private val api = SupabaseApi(
        supabaseUrl = BuildConfig.SUPABASE_URL,
        anonKey = BuildConfig.SUPABASE_ANON_KEY
    )

    suspend fun signUp(email: String, password: String, fullName: String): Result<Profile> = runApi {
        ensureSupabaseConfigured()
        val response = api.signUp(email, password, fullName)
        val token = response.accessToken
            ?: return@runApi failure("Signup succeeded, but no session returned. Disable email confirmation in Supabase Auth for now.")
        val user = response.user ?: return@runApi failure("Supabase did not return the created user")

        val profile = Profile(id = user.id, fullName = fullName, email = email)
        api.upsertProfile(profile, token)
        prefs.setSession(token, response.refreshToken, user.id)
        success(profile)
    }

    suspend fun signIn(email: String, password: String): Result<Profile> = runApi {
        ensureSupabaseConfigured()
        val response = api.signIn(email, password)
        val token = response.accessToken ?: return@runApi failure("Login failed")
        val user = response.user ?: return@runApi failure("Login failed")

        val profile = Profile(id = user.id, email = user.email)
        api.upsertProfile(profile, token)
        prefs.setSession(token, response.refreshToken, user.id)
        success(profile)
    }

    suspend fun signOut() {
        prefs.clearSessionScopedValues()
    }

    suspend fun createFamily(name: String, currencyCode: String, displayName: String?): Result<Family> = runApi {
        val session = requireSession()
        val normalizedCurrency = currencyCode.ifBlank { "INR" }.uppercase()
        val family = api.createFamily(name, session.userId, normalizedCurrency, session.accessToken)
        api.addFamilyMember(
            familyId = family.id,
            userId = session.userId,
            role = "OWNER",
            displayName = displayName,
            accessToken = session.accessToken
        )
        prefs.setActiveFamilyId(family.id)
        success(family)
    }

    suspend fun joinFamilyByInvite(inviteCode: String, displayName: String?): Result<Family> = runApi {
        val session = requireSession()
        val invite = api.getInviteByCode(inviteCode.uppercase(), session.accessToken)
            ?: return@runApi failure("Invite code is invalid or expired")

        api.addFamilyMember(
            familyId = invite.familyId,
            userId = session.userId,
            role = "MEMBER",
            displayName = displayName,
            accessToken = session.accessToken
        )
        api.markInviteAccepted(invite.id, session.accessToken)
        prefs.setActiveFamilyId(invite.familyId)

        val family = api.getFamily(invite.familyId, session.accessToken)
            ?: return@runApi failure("Family not found")
        success(family)
    }

    suspend fun createInvite(email: String): Result<FamilyInvite> = runApi {
        val session = requireSession()
        val family = requireFamily(session)
        val invite = api.createInvite(
            familyId = family.id,
            invitedEmail = email,
            inviteCode = generateInviteCode(),
            inviterId = session.userId,
            currencyCode = family.currencyCode,
            accessToken = session.accessToken
        )
        success(invite)
    }

    suspend fun loadDashboard(): Result<DashboardBundle> = runApi {
        val session = requireSession()
        val family = resolveFamily(session)
        val members = api.getFamilyMembers(family.id, session.accessToken)
        val categories = api.getCategories(family.id, session.accessToken)
        val expenses = api.getExpenses(family.id, session.accessToken).map { expense ->
            expense.copy(
                name = crypto.decryptIfEncrypted(family.expenseSecret, expense.name) ?: expense.name,
                notes = crypto.decryptIfEncrypted(family.expenseSecret, expense.notes)
            )
        }
        val incomes = api.getIncomes(family.id, session.accessToken)

        prefs.setActiveFamilyId(family.id)
        success(
            DashboardBundle(
                currentUserId = session.userId,
                family = family,
                members = members,
                categories = categories,
                expenses = expenses,
                incomes = incomes
            )
        )
    }

    suspend fun addCategory(name: String, scope: CategoryScope): Result<Category> = runApi {
        val session = requireSession()
        val family = requireFamily(session)
        val category = api.createCategory(family.id, name, scope, session.userId, session.accessToken)
        success(category)
    }

    suspend fun addExpense(draft: ExpenseDraft): Result<Expense> = runApi {
        val session = requireSession()
        val family = requireFamily(session)
        val encryptedName = crypto.encrypt(family.expenseSecret, draft.name)
        val encryptedNotes = draft.notes?.let { crypto.encrypt(family.expenseSecret, it) }
        val expense = api.createExpense(
            familyId = family.id,
            name = encryptedName,
            categoryId = draft.categoryId,
            amount = draft.amount,
            spentBy = session.userId,
            notes = encryptedNotes,
            accessToken = session.accessToken
        )
        prefs.setLastExpenseDate(LocalDate.now().toString())
        success(
            expense.copy(
                name = draft.name,
                notes = draft.notes
            )
        )
    }

    suspend fun updateExpense(
        expenseId: String,
        name: String,
        categoryId: String?,
        amount: Double,
        notes: String?
    ): Result<Expense> = runApi {
        val session = requireSession()
        val family = requireFamily(session)
        val encryptedName = crypto.encrypt(family.expenseSecret, name)
        val encryptedNotes = notes?.let { crypto.encrypt(family.expenseSecret, it) }
        val updated = api.updateExpense(
            expenseId = expenseId,
            name = encryptedName,
            categoryId = categoryId,
            amount = amount,
            notes = encryptedNotes,
            accessToken = session.accessToken
        )
        success(
            updated.copy(
                name = name,
                notes = notes
            )
        )
    }

    suspend fun deleteExpense(expenseId: String): Result<Unit> = runApi {
        val session = requireSession()
        api.deleteExpense(expenseId = expenseId, accessToken = session.accessToken)
        success(Unit)
    }

    suspend fun removeFamilyMember(memberId: String): Result<Unit> = runApi {
        val session = requireSession()
        val family = requireFamily(session)
        val members = api.getFamilyMembers(family.id, session.accessToken)
        val target = members.firstOrNull { it.id == memberId }
            ?: return@runApi failure("Family member not found")
        if (target.role == "OWNER") {
            return@runApi failure("Owner account cannot be removed")
        }
        api.deleteFamilyMember(
            memberId = memberId,
            familyId = family.id,
            accessToken = session.accessToken
        )
        success(Unit)
    }

    suspend fun addIncome(draft: IncomeDraft): Result<Income> = runApi {
        val session = requireSession()
        val family = requireFamily(session)
        val income = api.createIncome(
            familyId = family.id,
            title = draft.title,
            categoryId = draft.categoryId,
            amount = draft.amount,
            dayOfMonth = draft.dayOfMonth,
            accessToken = session.accessToken
        )
        success(income)
    }

    suspend fun updateIncome(income: Income): Result<Income> = runApi {
        val session = requireSession()
        val updated = api.updateIncome(
            incomeId = income.id,
            title = income.title,
            categoryId = income.categoryId,
            amount = income.amount,
            dayOfMonth = income.dayOfMonth,
            isActive = income.isActive,
            accessToken = session.accessToken
        )
        success(updated)
    }

    suspend fun hasLoggedExpenseToday(): Boolean {
        val today = LocalDate.now().toString()
        return prefs.lastExpenseDate.first() == today
    }

    suspend fun hasSession(): Boolean {
        return prefs.accessToken.first() != null && prefs.userId.first() != null
    }

    private suspend fun resolveFamily(session: Session): Family {
        val configured = prefs.activeFamilyId.first()
        if (configured != null) {
            val byPreference = api.getFamily(configured, session.accessToken)
            if (byPreference != null) {
                return byPreference
            }
        }

        val membership = api.getUserFamilyMemberships(session.userId, session.accessToken).firstOrNull()
            ?: throw IllegalStateException("No family found. Create one or join with invite code.")
        val family = api.getFamily(membership.familyId, session.accessToken)
            ?: throw IllegalStateException("Family not found")
        prefs.setActiveFamilyId(family.id)
        return family
    }

    private suspend fun requireFamily(session: Session): Family {
        val familyId = prefs.activeFamilyId.first()
            ?: throw IllegalStateException("No active family. Create or join a family first.")
        return api.getFamily(familyId, session.accessToken)
            ?: throw IllegalStateException("Family not found")
    }

    private suspend fun requireSession(): Session {
        ensureSupabaseConfigured()
        val token = prefs.accessToken.first() ?: throw IllegalStateException("User not logged in")
        val userId = prefs.userId.first() ?: throw IllegalStateException("User not logged in")
        return Session(token, userId)
    }

    private fun generateInviteCode(): String {
        val source = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
        return (1..8)
            .map { source.random() }
            .joinToString("")
    }

    private fun ensureSupabaseConfigured() {
        if (BuildConfig.SUPABASE_URL.isBlank() || BuildConfig.SUPABASE_ANON_KEY.isBlank()) {
            throw IllegalStateException("Missing SUPABASE_URL or SUPABASE_ANON_KEY in gradle.properties")
        }
    }

    private suspend fun <T> runApi(call: suspend () -> Result<T>): Result<T> {
        return withContext(Dispatchers.IO) {
            try {
                call()
            } catch (t: Throwable) {
                if (isJwtExpiredError(t) && refreshSessionIfNeeded()) {
                    try {
                        return@withContext call()
                    } catch (retryError: Throwable) {
                        val raw = retryError.message ?: "Unexpected error"
                        val cleaned = extractSupabaseMessage(raw)
                        return@withContext Result.failure(IllegalStateException(cleaned, retryError))
                    }
                }
                val raw = t.message ?: "Unexpected error"
                val cleaned = extractSupabaseMessage(raw)
                Result.failure(IllegalStateException(cleaned, t))
            }
        }
    }

    private fun <T> success(value: T): Result<T> = Result.success(value)

    private fun <T> failure(message: String): Result<T> = Result.failure(IllegalStateException(message))

    private fun extractSupabaseMessage(raw: String): String {
        val normalized = raw.replace("\\\"", "\"")
        val messageMatch = Regex("\"message\":\"([^\"]+)\"").find(normalized)
        if (messageMatch != null) {
            return messageMatch.groupValues[1]
        }
        return raw
    }

    private fun isJwtExpiredError(error: Throwable): Boolean {
        val message = (error.message ?: "").lowercase()
        return message.contains("jwt expired") ||
            message.contains("token is expired") ||
            message.contains("invalid jwt") ||
            message.contains("pgrst301")
    }

    private suspend fun refreshSessionIfNeeded(): Boolean {
        val refreshToken = prefs.refreshToken.first() ?: return false
        return try {
            val auth = api.refreshSession(refreshToken)
            val accessToken = auth.accessToken ?: return false
            val userId = auth.user?.id ?: prefs.userId.first() ?: return false
            val nextRefreshToken = auth.refreshToken ?: refreshToken
            prefs.setSession(accessToken = accessToken, refreshToken = nextRefreshToken, userId = userId)
            true
        } catch (_: Throwable) {
            false
        }
    }
}

data class DashboardBundle(
    val currentUserId: String,
    val family: Family,
    val members: List<FamilyMember>,
    val categories: List<Category>,
    val expenses: List<Expense>,
    val incomes: List<Income>
)

data class Session(
    val accessToken: String,
    val userId: String
)
