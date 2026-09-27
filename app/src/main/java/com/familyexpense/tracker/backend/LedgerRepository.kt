package com.familyexpense.tracker.backend

import com.familyexpense.tracker.data.FamilyCrypto
import kotlinx.serialization.json.Json
import javax.crypto.SecretKey

/** A decrypted expense, ready to show. */
data class Expense(
    val id: String?,
    val title: String,
    val amount: Double,
    val spentOn: String,
    val personId: String,
    val categoryId: String?,
    val note: String?
)

data class Category(val id: String, val name: String, val scope: String, val color: String)
data class Person(val id: String, val name: String, val linkedUserId: String?)

/**
 * Turns encrypted rows into things the UI can show, and back again.
 *
 * A row that will not decrypt is skipped rather than surfaced as an error: a
 * single bad row should never stop the rest of the family's ledger from loading.
 */
class LedgerRepository(
    private val api: SupabaseClient,
    private val json: Json = Json { ignoreUnknownKeys = true; encodeDefaults = true }
) {

    suspend fun loadExpenses(token: String, key: SecretKey): List<Expense> =
        api.expenses(token).mapNotNull { row ->
            val plain = FamilyCrypto.decryptOrNull(key, row.encryptedPayload) ?: return@mapNotNull null
            val p = runCatching { json.decodeFromString<ExpensePayload>(plain) }.getOrNull()
                ?: return@mapNotNull null
            Expense(row.id, p.title, p.amount, p.spentOn, p.personId, p.categoryId, p.note)
        }

    suspend fun loadCategories(token: String, key: SecretKey): List<Category> =
        api.categories(token).mapNotNull { row ->
            val plain = FamilyCrypto.decryptOrNull(key, row.encryptedPayload) ?: return@mapNotNull null
            val p = runCatching { json.decodeFromString<CategoryPayload>(plain) }.getOrNull()
                ?: return@mapNotNull null
            Category(row.id, p.name, p.scope.ifBlank { row.scope }, p.color)
        }.filter { it.name.isNotBlank() }

    suspend fun loadPeople(token: String, key: SecretKey): List<Person> =
        api.people(token).mapNotNull { row ->
            val plain = FamilyCrypto.decryptOrNull(key, row.encryptedPayload) ?: return@mapNotNull null
            val p = runCatching { json.decodeFromString<PersonPayload>(plain) }.getOrNull()
                ?: return@mapNotNull null
            Person(row.id, p.displayName, row.linkedUserId)
        }.filter { it.name.isNotBlank() }

    /**
     * Writes an expense the way the web app does: real values encrypted, and
     * decoys in the plaintext columns so the row satisfies its constraints
     * without disclosing anything. Anyone reading the database directly sees
     * "Encrypted expense" and a rupee.
     */
    suspend fun addExpense(
        token: String,
        key: SecretKey,
        familyId: String,
        userId: String,
        title: String,
        amount: Double,
        spentOn: String,
        personId: String,
        categoryId: String?,
        note: String?
    ): Result<Unit> {
        val payload = ExpensePayload(
            familyId = familyId,
            title = title,
            amount = amount,
            spentOn = spentOn,
            personId = personId,
            categoryId = categoryId,
            note = note,
            enteredBy = userId
        )
        val row = ExpenseRow(
            familyId = familyId,
            title = "Encrypted expense",
            amount = 1.0,
            spentOn = spentOn,
            personId = personId,
            // Deliberately null: the real category rides inside the payload, and
            // the insert policy only requires the person to belong to the family.
            categoryId = null,
            note = null,
            enteredBy = userId,
            encryptedPayload = FamilyCrypto.encrypt(key, json.encodeToString(ExpensePayload.serializer(), payload)),
            encryptionVersion = 1
        )
        return api.insertExpense(token, row)
    }
}
