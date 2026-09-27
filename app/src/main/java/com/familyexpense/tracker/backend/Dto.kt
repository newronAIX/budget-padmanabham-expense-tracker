package com.familyexpense.tracker.backend

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Wire shapes for the CURRENT schema.
 *
 * Replaces domain/Models.kt, which still expected budget_families.expense_secret
 * -- a column that no longer exists. Everything the family can read is carried in
 * encrypted_payload; the plaintext columns beside it hold deliberate decoys
 * ("Encrypted expense", amount 1) written by the web app so the row satisfies its
 * NOT NULL and CHECK constraints without disclosing anything.
 */

@Serializable
data class FamilyRow(
    @SerialName("id") val id: String,
    @SerialName("owner_id") val ownerId: String,
    @SerialName("currency_code") val currencyCode: String = "INR",
    @SerialName("invite_code") val inviteCode: String? = null,
    @SerialName("invite_locked") val inviteLocked: Boolean = false,
    @SerialName("encryption_salt") val encryptionSalt: String? = null,
    @SerialName("encryption_check") val encryptionCheck: String? = null,
    @SerialName("key_fingerprint") val keyFingerprint: String? = null,
    @SerialName("encrypted_payload") val encryptedPayload: String? = null
)

@Serializable
data class MembershipRow(
    @SerialName("family_id") val familyId: String,
    @SerialName("role") val role: String
) {
    val isOwner: Boolean get() = role == "OWNER"
}

@Serializable
data class PersonRow(
    @SerialName("id") val id: String,
    @SerialName("family_id") val familyId: String,
    @SerialName("linked_user_id") val linkedUserId: String? = null,
    @SerialName("encrypted_payload") val encryptedPayload: String? = null
)

@Serializable
data class CategoryRow(
    @SerialName("id") val id: String,
    @SerialName("family_id") val familyId: String,
    @SerialName("scope") val scope: String = "EXPENSE",
    @SerialName("encrypted_payload") val encryptedPayload: String? = null
)

@Serializable
data class ExpenseRow(
    @SerialName("id") val id: String? = null,
    @SerialName("family_id") val familyId: String,
    @SerialName("title") val title: String,
    @SerialName("amount") val amount: Double,
    @SerialName("spent_on") val spentOn: String,
    @SerialName("person_id") val personId: String,
    @SerialName("category_id") val categoryId: String? = null,
    @SerialName("note") val note: String? = null,
    @SerialName("entered_by") val enteredBy: String,
    @SerialName("encrypted_payload") val encryptedPayload: String? = null,
    @SerialName("encryption_version") val encryptionVersion: Int? = 1
)

/** The JSON inside encrypted_payload. Field names must match the web app exactly. */
@Serializable
data class ExpensePayload(
    @SerialName("family_id") val familyId: String,
    @SerialName("title") val title: String,
    @SerialName("amount") val amount: Double,
    @SerialName("spent_on") val spentOn: String,
    @SerialName("person_id") val personId: String,
    @SerialName("category_id") val categoryId: String? = null,
    @SerialName("note") val note: String? = null,
    @SerialName("entered_by") val enteredBy: String
)

@Serializable
data class CategoryPayload(
    @SerialName("name") val name: String = "",
    @SerialName("scope") val scope: String = "EXPENSE",
    @SerialName("color") val color: String = "#1B4332",
    @SerialName("monthly_limit") val monthlyLimit: Double = 0.0
)

@Serializable
data class PersonPayload(
    @SerialName("display_name") val displayName: String = ""
)

@Serializable
data class TokenResponse(
    @SerialName("access_token") val accessToken: String,
    @SerialName("refresh_token") val refreshToken: String,
    @SerialName("user") val user: AuthUser? = null
)

@Serializable
data class AuthUser(
    @SerialName("id") val id: String,
    @SerialName("email") val email: String? = null
)

@Serializable
data class InviteSecurityRow(
    @SerialName("family_id") val familyId: String? = null,
    @SerialName("family_name") val familyName: String? = null,
    @SerialName("encryption_salt") val encryptionSalt: String? = null
)
