package com.familyexpense.tracker.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.familyexpense.tracker.data.DashboardBundle
import com.familyexpense.tracker.data.ExpenseRepository
import com.familyexpense.tracker.domain.AppTab
import com.familyexpense.tracker.domain.Category
import com.familyexpense.tracker.domain.CategoryScope
import com.familyexpense.tracker.domain.CategorySpend
import com.familyexpense.tracker.domain.Expense
import com.familyexpense.tracker.domain.ExpenseDraft
import com.familyexpense.tracker.domain.Family
import com.familyexpense.tracker.domain.FamilyMember
import com.familyexpense.tracker.domain.Income
import com.familyexpense.tracker.domain.IncomeDraft
import com.familyexpense.tracker.domain.MemberSpend
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.YearMonth
import java.time.format.DateTimeParseException

class AppViewModel(application: Application) : AndroidViewModel(application) {

    private val repository = ExpenseRepository(application.applicationContext)

    private val _uiState = MutableStateFlow(AppUiState(isLoading = true))
    val uiState: StateFlow<AppUiState> = _uiState.asStateFlow()

    init {
        bootstrap()
    }

    fun bootstrap() {
        viewModelScope.launch {
            val hasSession = repository.hasSession()
            if (!hasSession) {
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        isAuthenticated = false,
                        needsFamilySetup = false
                    )
                }
                return@launch
            }
            refreshDashboard()
        }
    }

    fun selectTab(tab: AppTab) {
        _uiState.update { it.copy(selectedTab = tab) }
    }

    fun signIn(email: String, password: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, errorMessage = null) }
            repository.signIn(email, password)
                .onSuccess {
                    refreshDashboard()
                }
                .onFailure { error ->
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            isAuthenticated = false,
                            errorMessage = error.message ?: "Sign in failed"
                        )
                    }
                }
        }
    }

    fun signUp(fullName: String, email: String, password: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, errorMessage = null) }
            repository.signUp(email, password, fullName)
                .onSuccess {
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            isAuthenticated = true,
                            needsFamilySetup = true
                        )
                    }
                }
                .onFailure { error ->
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            isAuthenticated = false,
                            errorMessage = error.message ?: "Sign up failed"
                        )
                    }
                }
        }
    }

    fun createFamily(name: String, currencyCode: String, displayName: String?) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, errorMessage = null) }
            repository.createFamily(name, currencyCode, displayName)
                .onSuccess {
                    refreshDashboard()
                }
                .onFailure { error ->
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            errorMessage = error.message ?: "Could not create family"
                        )
                    }
                }
        }
    }

    fun joinFamily(inviteCode: String, displayName: String?) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, errorMessage = null) }
            repository.joinFamilyByInvite(inviteCode, displayName)
                .onSuccess {
                    refreshDashboard()
                }
                .onFailure { error ->
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            errorMessage = error.message ?: "Could not join family"
                        )
                    }
                }
        }
    }

    fun createInvite(email: String) {
        viewModelScope.launch {
            repository.createInvite(email)
                .onSuccess { invite ->
                    _uiState.update {
                        it.copy(
                            latestInviteCode = invite.inviteCode,
                            errorMessage = null
                        )
                    }
                }
                .onFailure { error ->
                    _uiState.update { it.copy(errorMessage = error.message ?: "Could not create invite") }
                }
        }
    }

    fun addCategory(name: String, scope: CategoryScope) {
        viewModelScope.launch {
            repository.addCategory(name, scope)
                .onSuccess {
                    refreshDashboard()
                }
                .onFailure { error ->
                    _uiState.update { it.copy(errorMessage = error.message ?: "Could not add category") }
                }
        }
    }

    fun addExpense(name: String, categoryId: String?, amount: Double, notes: String?) {
        viewModelScope.launch {
            repository.addExpense(
                ExpenseDraft(
                    name = name,
                    categoryId = categoryId,
                    amount = amount,
                    notes = notes
                )
            ).onSuccess {
                refreshDashboard()
            }.onFailure { error ->
                _uiState.update { it.copy(errorMessage = error.message ?: "Could not add expense") }
            }
        }
    }

    fun updateExpense(expense: Expense, name: String, categoryId: String?, amount: Double, notes: String?) {
        viewModelScope.launch {
            repository.updateExpense(
                expenseId = expense.id,
                name = name,
                categoryId = categoryId,
                amount = amount,
                notes = notes
            ).onSuccess {
                refreshDashboard()
            }.onFailure { error ->
                _uiState.update { it.copy(errorMessage = error.message ?: "Could not update expense") }
            }
        }
    }

    fun deleteExpense(expenseId: String) {
        viewModelScope.launch {
            repository.deleteExpense(expenseId)
                .onSuccess {
                    refreshDashboard()
                }
                .onFailure { error ->
                    _uiState.update { it.copy(errorMessage = error.message ?: "Could not delete expense") }
                }
        }
    }

    fun removeFamilyMember(memberId: String) {
        viewModelScope.launch {
            repository.removeFamilyMember(memberId)
                .onSuccess {
                    refreshDashboard()
                }
                .onFailure { error ->
                    _uiState.update { it.copy(errorMessage = error.message ?: "Could not remove family member") }
                }
        }
    }

    fun addIncome(title: String, categoryId: String?, amount: Double, dayOfMonth: Int) {
        viewModelScope.launch {
            repository.addIncome(
                IncomeDraft(
                    title = title,
                    categoryId = categoryId,
                    amount = amount,
                    dayOfMonth = dayOfMonth
                )
            )
                .onSuccess {
                    refreshDashboard()
                }
                .onFailure { error ->
                    _uiState.update { it.copy(errorMessage = error.message ?: "Could not add income") }
                }
        }
    }

    fun toggleIncomeActive(income: Income) {
        viewModelScope.launch {
            repository.updateIncome(income.copy(isActive = !income.isActive))
                .onSuccess {
                    refreshDashboard()
                }
                .onFailure { error ->
                    _uiState.update { it.copy(errorMessage = error.message ?: "Could not update income") }
                }
        }
    }

    fun updateIncome(
        income: Income,
        title: String,
        categoryId: String?,
        amount: Double,
        dayOfMonth: Int,
        isActive: Boolean
    ) {
        viewModelScope.launch {
            repository.updateIncome(
                income.copy(
                    title = title,
                    categoryId = categoryId,
                    amount = amount,
                    dayOfMonth = dayOfMonth,
                    isActive = isActive
                )
            ).onSuccess {
                refreshDashboard()
            }.onFailure { error ->
                _uiState.update { it.copy(errorMessage = error.message ?: "Could not update income") }
            }
        }
    }

    fun signOut() {
        viewModelScope.launch {
            repository.signOut()
            _uiState.value = AppUiState(isLoading = false)
        }
    }

    fun clearError() {
        _uiState.update { it.copy(errorMessage = null) }
    }

    fun clearInviteCode() {
        _uiState.update { it.copy(latestInviteCode = null) }
    }

    private suspend fun refreshDashboard() {
        repository.loadDashboard()
            .onSuccess { bundle ->
                _uiState.value = bundle.toUiState(
                    selectedTab = _uiState.value.selectedTab,
                    latestInviteCode = _uiState.value.latestInviteCode
                )
            }
            .onFailure { error ->
                val message = error.message ?: "Could not load data"
                val noFamily = message.contains("No family found", ignoreCase = true)
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        isAuthenticated = true,
                        needsFamilySetup = noFamily,
                        errorMessage = message
                    )
                }
            }
    }
}

data class AppUiState(
    val isLoading: Boolean = false,
    val isAuthenticated: Boolean = false,
    val needsFamilySetup: Boolean = false,
    val currentUserId: String? = null,
    val selectedTab: AppTab = AppTab.Expenses,
    val family: Family? = null,
    val members: List<FamilyMember> = emptyList(),
    val categories: List<Category> = emptyList(),
    val expenseCategories: List<Category> = emptyList(),
    val incomeCategories: List<Category> = emptyList(),
    val expenses: List<Expense> = emptyList(),
    val allExpenses: List<Expense> = emptyList(),
    val incomes: List<Income> = emptyList(),
    val memberSpend: List<MemberSpend> = emptyList(),
    val categorySpend: List<CategorySpend> = emptyList(),
    val totalMonthlyIncome: Double = 0.0,
    val totalMonthlyExpense: Double = 0.0,
    val netSavings: Double = 0.0,
    val totalYearlyIncome: Double = 0.0,
    val totalYearlyExpense: Double = 0.0,
    val yearlyNetSavings: Double = 0.0,
    val latestInviteCode: String? = null,
    val errorMessage: String? = null
)

private fun DashboardBundle.toUiState(selectedTab: AppTab, latestInviteCode: String?): AppUiState {
    val expenseCategories = categories.filter { it.scope == CategoryScope.EXPENSE }
    val incomeCategories = categories.filter { it.scope == CategoryScope.INCOME }

    val currentMonth = YearMonth.now()
    val currentYear = currentMonth.year
    val currentMonthExpenses = expenses.filter { expense ->
        parseYearMonth(expense.spentAt) == currentMonth
    }
    val currentYearExpenses = expenses.filter { expense ->
        parseYearMonth(expense.spentAt)?.year == currentYear
    }

    val activeIncomes = incomes.filter { it.isActive }
    val totalIncome = activeIncomes.sumOf { it.amount }
    val totalYearlyIncome = activeIncomes.sumOf { income ->
        income.amount * monthsActiveInCurrentYear(income, currentMonth)
    }
    val totalExpense = currentMonthExpenses.sumOf { it.amount }
    val totalYearlyExpense = currentYearExpenses.sumOf { it.amount }

    val memberNames = members.associate { member ->
        val name = member.displayName?.takeIf { it.isNotBlank() } ?: "Member"
        member.userId to name
    }

    val memberSpend = currentMonthExpenses
        .groupBy { it.spentBy }
        .map { (userId, rows) ->
            MemberSpend(
                memberName = rows.firstOrNull()?.spentByName
                    ?: memberNames[userId]
                    ?: "Member",
                total = rows.sumOf { it.amount }
            )
        }
        .sortedByDescending { it.total }

    val categoryMap = expenseCategories.associateBy { it.id }
    val categorySpend = currentMonthExpenses
        .groupBy { it.categoryId }
        .map { (categoryId, rows) ->
            CategorySpend(
                categoryName = categoryMap[categoryId]?.name ?: rows.firstOrNull()?.categoryName ?: "Uncategorized",
                total = rows.sumOf { it.amount }
            )
        }
        .sortedByDescending { it.total }

    return AppUiState(
        isLoading = false,
        isAuthenticated = true,
        needsFamilySetup = false,
        currentUserId = currentUserId,
        selectedTab = selectedTab,
        family = family,
        members = members,
        categories = categories,
        expenseCategories = expenseCategories,
        incomeCategories = incomeCategories,
        expenses = currentMonthExpenses.sortedByDescending { it.spentAt },
        allExpenses = expenses.sortedByDescending { it.spentAt },
        incomes = incomes,
        memberSpend = memberSpend,
        categorySpend = categorySpend,
        totalMonthlyIncome = totalIncome,
        totalMonthlyExpense = totalExpense,
        netSavings = totalIncome - totalExpense,
        totalYearlyIncome = totalYearlyIncome,
        totalYearlyExpense = totalYearlyExpense,
        yearlyNetSavings = totalYearlyIncome - totalYearlyExpense,
        latestInviteCode = latestInviteCode
    )
}

private fun parseYearMonth(isoValue: String): YearMonth? {
    return try {
        YearMonth.from(OffsetDateTime.parse(isoValue))
    } catch (_: DateTimeParseException) {
        try {
            YearMonth.from(LocalDateTime.parse(isoValue))
        } catch (_: DateTimeParseException) {
            null
        }
    }
}

private fun monthsActiveInCurrentYear(income: Income, currentMonth: YearMonth): Int {
    val createdAt = income.createdAt ?: return currentMonth.monthValue
    val createdMonth = parseYearMonth(createdAt) ?: return currentMonth.monthValue
    if (createdMonth.year < currentMonth.year) {
        return currentMonth.monthValue
    }
    if (createdMonth.year > currentMonth.year) {
        return 0
    }
    return (currentMonth.monthValue - createdMonth.monthValue + 1).coerceAtLeast(0)
}
