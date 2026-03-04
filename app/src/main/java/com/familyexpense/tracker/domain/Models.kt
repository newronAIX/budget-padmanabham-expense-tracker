package com.familyexpense.tracker.domain

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import java.time.LocalDateTime

@Serializable
data class Profile(
    @SerialName("id") val id: String,
    @SerialName("full_name") val fullName: String? = null,
    @SerialName("email") val email: String? = null
)

@Serializable
data class Family(
    @SerialName("id") val id: String,
    @SerialName("name") val name: String,
    @SerialName("owner_id") val ownerId: String,
    @SerialName("currency_code") val currencyCode: String,
    @SerialName("expense_secret") val expenseSecret: String? = null,
    @SerialName("created_at") val createdAt: String? = null
)

@Serializable
data class FamilyMember(
    @SerialName("id") val id: String,
    @SerialName("family_id") val familyId: String,
    @SerialName("user_id") val userId: String,
    @SerialName("role") val role: String,
    @SerialName("display_name") val displayName: String? = null
)

@Serializable
data class Category(
    @SerialName("id") val id: String,
    @SerialName("family_id") val familyId: String,
    @SerialName("name") val name: String,
    @SerialName("scope") val scope: CategoryScope = CategoryScope.EXPENSE,
    @SerialName("created_by") val createdBy: String,
    @SerialName("created_at") val createdAt: String? = null
)

@Serializable
data class Expense(
    @SerialName("id") val id: String,
    @SerialName("family_id") val familyId: String,
    @SerialName("name") val name: String,
    @SerialName("category_id") val categoryId: String? = null,
    @SerialName("category_name") val categoryName: String? = null,
    @SerialName("amount") val amount: Double,
    @SerialName("spent_by") val spentBy: String,
    @SerialName("spent_by_name") val spentByName: String? = null,
    @SerialName("spent_at") val spentAt: String,
    @SerialName("notes") val notes: String? = null
)

@Serializable
data class Income(
    @SerialName("id") val id: String,
    @SerialName("family_id") val familyId: String,
    @SerialName("title") val title: String,
    @SerialName("category_id") val categoryId: String? = null,
    @SerialName("category_name") val categoryName: String? = null,
    @SerialName("amount") val amount: Double,
    @SerialName("day_of_month") val dayOfMonth: Int,
    @SerialName("is_active") val isActive: Boolean = true,
    @SerialName("created_at") val createdAt: String? = null
)

@Serializable
data class FamilyInvite(
    @SerialName("id") val id: String,
    @SerialName("family_id") val familyId: String,
    @SerialName("invited_email") val invitedEmail: String,
    @SerialName("invite_code") val inviteCode: String,
    @SerialName("inviter_id") val inviterId: String,
    @SerialName("status") val status: String = "PENDING"
)

data class ExpenseDraft(
    val name: String,
    val categoryId: String?,
    val amount: Double,
    val notes: String? = null
)

data class IncomeDraft(
    val title: String,
    val categoryId: String?,
    val amount: Double,
    val dayOfMonth: Int
)

enum class AppTab(val title: String) {
    Expenses("Expenses"),
    Metrics("Metrics"),
    Charts("Charts"),
    Income("Income"),
    Account("Account")
}

@Serializable
enum class CategoryScope {
    @SerialName("EXPENSE")
    EXPENSE,

    @SerialName("INCOME")
    INCOME
}

data class MemberSpend(
    val memberName: String,
    val total: Double
)

data class CategorySpend(
    val categoryName: String,
    val total: Double
)

fun nowIso(): String = LocalDateTime.now().toString()
