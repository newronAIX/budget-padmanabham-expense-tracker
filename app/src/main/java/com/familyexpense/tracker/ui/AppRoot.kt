package com.familyexpense.tracker.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.BarChart
import androidx.compose.material.icons.filled.Home
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Switch
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.familyexpense.tracker.domain.AppTab
import com.familyexpense.tracker.domain.Category
import com.familyexpense.tracker.domain.CategoryScope
import com.familyexpense.tracker.domain.CategorySpend
import com.familyexpense.tracker.domain.Expense
import com.familyexpense.tracker.domain.FamilyMember
import com.familyexpense.tracker.domain.Income
import com.familyexpense.tracker.R
import java.text.NumberFormat
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.YearMonth
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException
import java.util.Currency
import kotlin.math.absoluteValue
import kotlin.math.roundToInt

@Composable
fun AppRoot(viewModel: AppViewModel) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val snackBarState = remember { SnackbarHostState() }

    LaunchedEffect(state.errorMessage) {
        state.errorMessage?.let {
            snackBarState.showSnackbar(it)
            viewModel.clearError()
        }
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackBarState) }
    ) { padding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            when {
                state.isLoading -> {
                    CircularProgressIndicator(modifier = Modifier.align(Alignment.Center))
                }

                !state.isAuthenticated -> {
                    AuthScreen(
                        onSignIn = viewModel::signIn,
                        onSignUp = viewModel::signUp
                    )
                }

                state.needsFamilySetup -> {
                    FamilySetupScreen(
                        onCreateFamily = viewModel::createFamily,
                        onJoinFamily = viewModel::joinFamily,
                        onSignOut = viewModel::signOut
                    )
                }

                else -> {
                    MainHomeScreen(
                        state = state,
                        onTabSelected = viewModel::selectTab,
                        onAddExpense = viewModel::addExpense,
                        onUpdateExpense = viewModel::updateExpense,
                        onDeleteExpense = viewModel::deleteExpense,
                        onAddExpenseCategory = { name -> viewModel.addCategory(name, CategoryScope.EXPENSE) },
                        onAddIncomeCategory = { name -> viewModel.addCategory(name, CategoryScope.INCOME) },
                        onCreateInvite = viewModel::createInvite,
                        onAddIncome = viewModel::addIncome,
                        onToggleIncome = viewModel::toggleIncomeActive,
                        onUpdateIncome = viewModel::updateIncome,
                        onRemoveFamilyMember = viewModel::removeFamilyMember,
                        onSignOut = viewModel::signOut,
                        onInviteSeen = viewModel::clearInviteCode
                    )
                }
            }
        }
    }
}

@Composable
private fun AuthScreen(
    onSignIn: (String, String) -> Unit,
    onSignUp: (String, String, String) -> Unit
) {
    var selectedIndex by rememberSaveable { mutableStateOf(0) }
    var fullName by rememberSaveable { mutableStateOf("") }
    var email by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(20.dp),
        verticalArrangement = Arrangement.Center
    ) {
        Box(
            modifier = Modifier
                .size(72.dp)
                .background(MaterialTheme.colorScheme.primary, CircleShape),
            contentAlignment = Alignment.Center
        ) {
            Text(
                text = "₹",
                style = MaterialTheme.typography.headlineLarge,
                fontWeight = FontWeight.Bold,
                color = Color.White
            )
        }
        Spacer(modifier = Modifier.height(12.dp))
        BrandWordmark(style = MaterialTheme.typography.headlineMedium)
        Spacer(modifier = Modifier.height(12.dp))
        Text(
            text = "Shared spending, recurring income, and insights for your household.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )

        Spacer(modifier = Modifier.height(20.dp))

        TabRow(selectedTabIndex = selectedIndex) {
            Tab(selected = selectedIndex == 0, onClick = { selectedIndex = 0 }, text = { Text("Sign in") })
            Tab(selected = selectedIndex == 1, onClick = { selectedIndex = 1 }, text = { Text("Sign up") })
        }

        Spacer(modifier = Modifier.height(16.dp))

        if (selectedIndex == 1) {
            OutlinedTextField(
                value = fullName,
                onValueChange = { fullName = it },
                label = { Text("Full name") },
                modifier = Modifier.fillMaxWidth()
            )
            Spacer(modifier = Modifier.height(10.dp))
        }

        OutlinedTextField(
            value = email,
            onValueChange = { email = it.trim() },
            label = { Text("Email") },
            modifier = Modifier.fillMaxWidth()
        )
        Spacer(modifier = Modifier.height(10.dp))
        OutlinedTextField(
            value = password,
            onValueChange = { password = it },
            label = { Text("Password") },
            modifier = Modifier.fillMaxWidth()
        )

        Spacer(modifier = Modifier.height(16.dp))

        Button(
            onClick = {
                if (selectedIndex == 0) {
                    onSignIn(email, password)
                } else {
                    onSignUp(fullName.ifBlank { "Family Member" }, email, password)
                }
            },
            modifier = Modifier.fillMaxWidth()
        ) {
            Text(if (selectedIndex == 0) "Sign in" else "Create account")
        }
    }
}

@Composable
private fun FamilySetupScreen(
    onCreateFamily: (name: String, currency: String, displayName: String?) -> Unit,
    onJoinFamily: (inviteCode: String, displayName: String?) -> Unit,
    onSignOut: () -> Unit
) {
    var displayName by rememberSaveable { mutableStateOf("") }
    var familyName by rememberSaveable { mutableStateOf("") }
    var currencyCode by rememberSaveable { mutableStateOf("INR") }
    var inviteCode by rememberSaveable { mutableStateOf("") }

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        item {
            BrandWordmark()
            Spacer(modifier = Modifier.height(8.dp))
            Text("Set up your family", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            Text(
                "The family owner sets the currency first, then invites members.",
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }

        item {
            OutlinedTextField(
                value = displayName,
                onValueChange = { displayName = it },
                modifier = Modifier.fillMaxWidth(),
                label = { Text("Your display name") }
            )
        }

        item {
            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.4f))) {
                Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("Create family", fontWeight = FontWeight.SemiBold)
                    OutlinedTextField(
                        value = familyName,
                        onValueChange = { familyName = it },
                        modifier = Modifier.fillMaxWidth(),
                        label = { Text("Family name") }
                    )
                    OutlinedTextField(
                        value = currencyCode,
                        onValueChange = { currencyCode = it.uppercase().take(3) },
                        modifier = Modifier.fillMaxWidth(),
                        label = { Text("Currency code (INR, USD, EUR)") }
                    )
                    Button(
                        onClick = {
                            onCreateFamily(
                                familyName.ifBlank { "Our Family" },
                                currencyCode.ifBlank { "INR" },
                                displayName.takeIf { it.isNotBlank() }
                            )
                        },
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text("Create family")
                    }
                }
            }
        }

        item {
            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.4f))) {
                Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("Join with invite code", fontWeight = FontWeight.SemiBold)
                    OutlinedTextField(
                        value = inviteCode,
                        onValueChange = { inviteCode = it.uppercase() },
                        modifier = Modifier.fillMaxWidth(),
                        label = { Text("Invite code") }
                    )
                    OutlinedButton(
                        onClick = {
                            onJoinFamily(
                                inviteCode,
                                displayName.takeIf { it.isNotBlank() }
                            )
                        },
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text("Join family")
                    }
                }
            }
        }

        item {
            TextButton(onClick = onSignOut, modifier = Modifier.fillMaxWidth()) {
                Text("Sign out")
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun MainHomeScreen(
    state: AppUiState,
    onTabSelected: (AppTab) -> Unit,
    onAddExpense: (name: String, categoryId: String?, amount: Double, notes: String?) -> Unit,
    onUpdateExpense: (expense: Expense, name: String, categoryId: String?, amount: Double, notes: String?) -> Unit,
    onDeleteExpense: (expenseId: String) -> Unit,
    onAddExpenseCategory: (String) -> Unit,
    onAddIncomeCategory: (String) -> Unit,
    onCreateInvite: (String) -> Unit,
    onAddIncome: (String, String?, Double, Int) -> Unit,
    onToggleIncome: (Income) -> Unit,
    onUpdateIncome: (Income, String, String?, Double, Int, Boolean) -> Unit,
    onRemoveFamilyMember: (String) -> Unit,
    onSignOut: () -> Unit,
    onInviteSeen: () -> Unit
) {
    var showExpenseDialog by rememberSaveable { mutableStateOf(false) }
    var showPastExpenses by rememberSaveable { mutableStateOf(false) }
    var insightsView by rememberSaveable { mutableStateOf(InsightsView.OVERVIEW) }
    val topCategoryIds = remember(state.allExpenses, state.currentUserId) {
        val userId = state.currentUserId ?: return@remember emptyList<String>()
        state.allExpenses
            .asSequence()
            .filter { expense -> expense.spentBy == userId }
            .mapNotNull { expense -> expense.categoryId }
            .groupingBy { categoryId -> categoryId }
            .eachCount()
            .entries
            .sortedByDescending { entry -> entry.value }
            .map { entry -> entry.key }
    }

    if (showPastExpenses) {
        PastExpensesScreen(
            state = state,
            onBack = { showPastExpenses = false }
        )
        return
    }

    if (showExpenseDialog) {
        AddExpenseDialog(
            categories = state.expenseCategories,
            topCategoryIds = topCategoryIds,
            onAddCategory = onAddExpenseCategory,
            existing = null,
            onDismiss = { showExpenseDialog = false },
            onSubmit = { name, categoryId, amount, notes ->
                onAddExpense(name, categoryId, amount, notes)
                showExpenseDialog = false
            }
        )
    }

    state.latestInviteCode?.let { code ->
        AlertDialog(
            onDismissRequest = onInviteSeen,
            title = { Text("Invite created") },
            text = {
                Text("Share this code with your family member: $code")
            },
            confirmButton = {
                TextButton(onClick = onInviteSeen) {
                    Text("Done")
                }
            }
        )
    }

    Scaffold(
        floatingActionButton = {
            if (state.selectedTab == AppTab.Home) {
                FloatingActionButton(
                    onClick = { showExpenseDialog = true },
                    shape = CircleShape,
                    containerColor = MaterialTheme.colorScheme.primary
                ) {
                    Icon(Icons.Default.Add, contentDescription = "Add expense", tint = Color.White)
                }
            }
        },
        floatingActionButtonPosition = androidx.compose.material3.FabPosition.Center,
        bottomBar = {
            NavigationBar {
                tabMeta.forEach { tab ->
                    NavigationBarItem(
                        selected = state.selectedTab == tab.tab,
                        onClick = { onTabSelected(tab.tab) },
                        icon = { Icon(tab.icon, contentDescription = tab.tab.title) },
                        label = { Text(tab.tab.title) }
                    )
                }
            }
        }
    ) { padding ->
        when (state.selectedTab) {
            AppTab.Home -> ExpensesTab(
                modifier = Modifier.padding(padding),
                state = state,
                onAddCategory = onAddExpenseCategory,
                onUpdateExpense = onUpdateExpense,
                onDeleteExpense = onDeleteExpense
            )

            AppTab.Insights -> InsightsHubTab(
                modifier = Modifier.padding(padding),
                state = state,
                selectedView = insightsView,
                onViewChange = { insightsView = it },
                onAddIncome = onAddIncome,
                onToggleIncome = onToggleIncome,
                onUpdateIncome = onUpdateIncome,
                onAddIncomeCategory = onAddIncomeCategory
            )

            AppTab.Account -> AccountTab(
                modifier = Modifier.padding(padding),
                state = state,
                onCreateInvite = onCreateInvite,
                onOpenPastExpenses = { showPastExpenses = true },
                onRemoveFamilyMember = onRemoveFamilyMember,
                onSignOut = onSignOut
            )
        }
    }
}

@Composable
private fun ExpensesTab(
    modifier: Modifier,
    state: AppUiState,
    onAddCategory: (String) -> Unit,
    onUpdateExpense: (expense: Expense, name: String, categoryId: String?, amount: Double, notes: String?) -> Unit,
    onDeleteExpense: (expenseId: String) -> Unit
) {
    val expenseListState = rememberLazyListState()
    var showCategoriesScreen by rememberSaveable { mutableStateOf(false) }
    var editingExpense by remember { mutableStateOf<Expense?>(null) }
    var sortOption by rememberSaveable { mutableStateOf(ExpenseSortOption.DATE) }
    var showSortMenu by remember { mutableStateOf(false) }
    val family = state.family ?: return
    val formatter = rememberCurrencyFormatter(family.currencyCode)
    val topCategoryIds = remember(state.allExpenses, state.currentUserId) {
        val userId = state.currentUserId ?: return@remember emptyList<String>()
        state.allExpenses
            .asSequence()
            .filter { expense -> expense.spentBy == userId }
            .mapNotNull { expense -> expense.categoryId }
            .groupingBy { categoryId -> categoryId }
            .eachCount()
            .entries
            .sortedByDescending { entry -> entry.value }
            .map { entry -> entry.key }
    }
    val sortedExpenses = remember(state.expenses, sortOption) {
        when (sortOption) {
            ExpenseSortOption.DATE -> state.expenses.sortedByDescending { it.spentAt }
            ExpenseSortOption.CATEGORY -> state.expenses.sortedWith(
                compareBy<Expense> { (it.categoryName ?: "Uncategorized").lowercase() }
                    .thenByDescending { it.spentAt }
            )
            ExpenseSortOption.PERSON -> state.expenses.sortedWith(
                compareBy<Expense> { (it.spentByName ?: "Member").lowercase() }
                    .thenByDescending { it.spentAt }
            )
        }
    }
    val income = state.totalMonthlyIncome.coerceAtLeast(0.0)
    val expense = state.totalMonthlyExpense.coerceAtLeast(0.0)
    val spendRatio = if (income <= 0.0) 1f else (expense / income).toFloat().coerceIn(0f, 1f)
    val budgetStatus = when {
        income <= 0.0 -> "Set monthly income"
        expense <= income * 0.85 -> "On track"
        expense <= income -> "Watch spending"
        else -> "Over budget"
    }
    val budgetStatusColor = when (budgetStatus) {
        "On track" -> MaterialTheme.colorScheme.primary
        "Watch spending" -> Color(0xFFB7791F)
        "Over budget" -> MaterialTheme.colorScheme.error
        else -> MaterialTheme.colorScheme.onSurfaceVariant
    }

    if (showCategoriesScreen) {
        ExpenseCategoriesScreen(
            modifier = modifier,
            categories = state.expenseCategories,
            onAddCategory = onAddCategory,
            onBack = { showCategoriesScreen = false }
        )
        return
    }

    editingExpense?.let { expense ->
        AddExpenseDialog(
            categories = state.expenseCategories,
            topCategoryIds = topCategoryIds,
            onAddCategory = onAddCategory,
            existing = expense,
            onDismiss = { editingExpense = null },
            onSubmit = { name, categoryId, amount, notes ->
                onUpdateExpense(expense, name, categoryId, amount, notes)
                editingExpense = null
            },
            onDelete = {
                onDeleteExpense(expense.id)
                editingExpense = null
            }
        )
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(horizontal = 16.dp)
            .padding(top = 14.dp, bottom = 100.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        BrandWordmark()

        MonthlySummaryCard(
            title = family.name,
            subtitle = "Monthly summary",
            incomeValue = formatter.format(state.totalMonthlyIncome),
            expenseValue = formatter.format(state.totalMonthlyExpense),
            extraContent = {
                Spacer(modifier = Modifier.height(8.dp))
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = budgetStatus,
                        style = MaterialTheme.typography.bodySmall,
                        fontWeight = FontWeight.SemiBold,
                        color = budgetStatusColor
                    )
                    Text(
                        text = if (income <= 0.0) "0%" else "${((expense / income).coerceAtLeast(0.0) * 100).toInt()}% used",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                LinearProgressIndicator(
                    progress = { spendRatio },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(8.dp),
                    color = budgetStatusColor,
                    trackColor = MaterialTheme.colorScheme.surfaceVariant
                )
            }
        )

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text("Recent expenses", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            Box {
                OutlinedButton(onClick = { showSortMenu = true }) {
                    Text("Sort: ${sortOption.label}")
                }
                DropdownMenu(
                    expanded = showSortMenu,
                    onDismissRequest = { showSortMenu = false }
                ) {
                    ExpenseSortOption.values().forEach { option ->
                        DropdownMenuItem(
                            text = { Text(option.label) },
                            onClick = {
                                sortOption = option
                                showSortMenu = false
                            }
                        )
                    }
                }
            }
        }

        Box(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f)
        ) {
            if (sortedExpenses.isEmpty()) {
                EmptyState("No expenses yet. Tap + to add your first one.")
            } else {
                LazyColumn(
                    state = expenseListState,
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(end = 10.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                    contentPadding = PaddingValues(bottom = 8.dp)
                ) {
                    items(sortedExpenses, key = { it.id }) { expense ->
                        ExpenseRow(
                            expense = expense,
                            formatter = formatter,
                            onClick = { editingExpense = expense }
                        )
                    }
                }
                ExpenseListScrollIndicator(
                    listState = expenseListState,
                    modifier = Modifier
                        .align(Alignment.CenterEnd)
                        .padding(vertical = 8.dp)
                )
            }
        }

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text("Categories", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            TextButton(onClick = { showCategoriesScreen = true }) {
                Text("Manage")
            }
        }

        OutlinedButton(
            onClick = { showCategoriesScreen = true },
            modifier = Modifier.fillMaxWidth()
        ) {
            Text("Open categories")
        }
    }
}

@Composable
private fun ExpenseCategoriesScreen(
    modifier: Modifier,
    categories: List<Category>,
    onAddCategory: (String) -> Unit,
    onBack: () -> Unit
) {
    var newCategory by rememberSaveable { mutableStateOf("") }
    val listState = rememberLazyListState()

    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(16.dp)
            .padding(bottom = 96.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text("Expense categories", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            TextButton(onClick = onBack) { Text("Back") }
        }

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            OutlinedTextField(
                value = newCategory,
                onValueChange = { newCategory = it },
                label = { Text("New category") },
                modifier = Modifier.weight(1f)
            )
            Button(
                onClick = {
                    val candidate = newCategory.trim()
                    if (candidate.isNotBlank()) {
                        onAddCategory(candidate)
                        newCategory = ""
                    }
                }
            ) {
                Text("Add")
            }
        }

        Box(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f)
        ) {
            if (categories.isEmpty()) {
                EmptyState("No categories yet. Add one like Groceries, Transport, Utilities.")
            } else {
                LazyColumn(
                    state = listState,
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(end = 10.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    items(categories, key = { it.id }) { category ->
                        Card(modifier = Modifier.fillMaxWidth()) {
                            Text(
                                text = category.name,
                                modifier = Modifier.padding(12.dp),
                                fontWeight = FontWeight.Medium
                            )
                        }
                    }
                }
                ExpenseListScrollIndicator(
                    listState = listState,
                    modifier = Modifier
                        .align(Alignment.CenterEnd)
                        .padding(vertical = 8.dp)
                )
            }
        }
    }
}

@Composable
private fun ExpenseListScrollIndicator(
    listState: androidx.compose.foundation.lazy.LazyListState,
    modifier: Modifier = Modifier
) {
    val layoutInfo = listState.layoutInfo
    val totalItems = layoutInfo.totalItemsCount
    val visibleItems = layoutInfo.visibleItemsInfo
    if (totalItems <= 0 || visibleItems.isEmpty() || visibleItems.size >= totalItems) return

    val firstVisibleIndex = visibleItems.first().index.toFloat()
    val visibleCount = visibleItems.size.toFloat()
    val totalCount = totalItems.toFloat()
    val thumbFraction = (visibleCount / totalCount).coerceIn(0.10f, 1f)
    val maxScrollableItems = (totalCount - visibleCount).coerceAtLeast(1f)
    val scrollFraction = (firstVisibleIndex / maxScrollableItems).coerceIn(0f, 1f)

    BoxWithConstraints(
        modifier = modifier
            .fillMaxHeight()
            .width(6.dp)
    ) {
        val trackColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.55f)
        val thumbColor = MaterialTheme.colorScheme.primary.copy(alpha = 0.70f)
        val thumbHeight = maxHeight * thumbFraction
        val thumbOffset = (maxHeight - thumbHeight) * scrollFraction

        Box(
            modifier = Modifier
                .fillMaxHeight()
                .width(3.dp)
                .align(Alignment.Center)
                .background(trackColor, CircleShape)
        )

        Box(
            modifier = Modifier
                .align(Alignment.TopCenter)
                .offset(y = thumbOffset)
                .width(4.dp)
                .height(thumbHeight)
                .background(thumbColor, CircleShape)
        )
    }
}

@Composable
private fun InviteCard(
    onCreateInvite: (String) -> Unit
) {
    var email by rememberSaveable { mutableStateOf("") }

    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer)) {
        Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("Invite family members", fontWeight = FontWeight.SemiBold)
            Text(
                "Send an invite code after entering their email.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSecondaryContainer
            )
            OutlinedTextField(
                value = email,
                onValueChange = { email = it.trim() },
                label = { Text("Family member email") },
                modifier = Modifier.fillMaxWidth()
            )
            Button(
                onClick = {
                    if (email.isNotBlank()) {
                        onCreateInvite(email)
                        email = ""
                    }
                },
                modifier = Modifier.fillMaxWidth()
            ) {
                Text("Generate invite")
            }
        }
    }
}

@Composable
private fun AccountTab(
    modifier: Modifier,
    state: AppUiState,
    onCreateInvite: (String) -> Unit,
    onOpenPastExpenses: () -> Unit,
    onRemoveFamilyMember: (String) -> Unit,
    onSignOut: () -> Unit
) {
    val family = state.family ?: return
    val formatter = rememberCurrencyFormatter(family.currencyCode)
    val isOwner = state.currentUserId == family.ownerId
    var memberToRemove by remember { mutableStateOf<FamilyMember?>(null) }

    memberToRemove?.let { member ->
        val memberName = member.displayName?.takeIf { it.isNotBlank() } ?: "Member"
        AlertDialog(
            onDismissRequest = { memberToRemove = null },
            title = { Text("Remove family member") },
            text = { Text("Remove $memberName from ${family.name}? Their past expenses will remain in records.") },
            confirmButton = {
                TextButton(
                    onClick = {
                        onRemoveFamilyMember(member.id)
                        memberToRemove = null
                    }
                ) {
                    Text("Remove")
                }
            },
            dismissButton = {
                TextButton(onClick = { memberToRemove = null }) {
                    Text("Cancel")
                }
            }
        )
    }

    LazyColumn(
        modifier = modifier
            .fillMaxSize()
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
        contentPadding = PaddingValues(bottom = 96.dp)
    ) {
        item {
            BrandWordmark()
        }

        item {
            Text("Account", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        }

        item {
            MonthlySummaryCard(
                title = family.name,
                subtitle = "Family currency: ${family.currencyCode}",
                incomeValue = formatter.format(state.totalMonthlyIncome),
                expenseValue = formatter.format(state.totalMonthlyExpense)
            )
        }

        item {
            OutlinedButton(
                onClick = onOpenPastExpenses,
                modifier = Modifier.fillMaxWidth()
            ) {
                Text("Past expenses")
            }
        }

        if (isOwner) {
            item {
                InviteCard(onCreateInvite = onCreateInvite)
            }

            item {
                Text("Family members", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            }

            if (state.members.isEmpty()) {
                item {
                    Text(
                        "No members found.",
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            } else {
                items(state.members, key = { it.id }) { member ->
                    val memberName = member.displayName?.takeIf { it.isNotBlank() } ?: "Member"
                    val canRemove = member.role != "OWNER"
                    Card {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(12.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Column(modifier = Modifier.weight(1f)) {
                                Text(memberName, fontWeight = FontWeight.SemiBold)
                                Text(
                                    if (member.role == "OWNER") "Owner" else "Member",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                            if (canRemove) {
                                TextButton(onClick = { memberToRemove = member }) {
                                    Text("Remove")
                                }
                            }
                        }
                    }
                }
            }
        }

        item {
            Button(onClick = onSignOut, modifier = Modifier.fillMaxWidth()) {
                Text("Sign out")
            }
        }
    }
}

@Composable
private fun PastExpensesScreen(
    state: AppUiState,
    onBack: () -> Unit
) {
    val historyListState = rememberLazyListState()
    val family = state.family ?: return
    val formatter = rememberCurrencyFormatter(family.currencyCode)
    val monthSummaries = remember(state.allExpenses, state.incomes) {
        buildMonthSummaries(state.allExpenses, state.incomes)
    }
    var selectedMonthKey by rememberSaveable { mutableStateOf<String?>(null) }
    var showCharts by rememberSaveable(selectedMonthKey) { mutableStateOf(false) }
    val selectedMonth = selectedMonthKey?.let { runCatching { YearMonth.parse(it) }.getOrNull() }

    if (selectedMonth == null) {
        LazyColumn(
            state = historyListState,
            modifier = Modifier
                .fillMaxSize()
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            contentPadding = PaddingValues(bottom = 24.dp)
        ) {
            item {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text("Past expenses", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                    TextButton(onClick = onBack) { Text("Back") }
                }
            }

            if (monthSummaries.isEmpty()) {
                item { EmptyState("No historical expenses found yet.") }
            } else {
                items(monthSummaries, key = { it.month.toString() }) { summary ->
                    Card(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { selectedMonthKey = summary.month.toString() }
                    ) {
                        Column(
                            modifier = Modifier.padding(12.dp),
                            verticalArrangement = Arrangement.spacedBy(4.dp)
                        ) {
                            Text(
                                summary.month.format(DateTimeFormatter.ofPattern("MMMM yyyy")),
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.SemiBold
                            )
                            Text("Total expense: ${formatter.format(summary.totalExpense)}")
                            Text("Entries: ${summary.expenseCount}")
                            if (summary.incomeCategoryTotals.isNotEmpty()) {
                                Text(
                                    "Income categories",
                                    style = MaterialTheme.typography.bodySmall,
                                    fontWeight = FontWeight.SemiBold
                                )
                                summary.incomeCategoryTotals.take(3).forEach { incomeCategory ->
                                    Text(
                                        "${incomeCategory.categoryName}: ${formatter.format(incomeCategory.total)}",
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant
                                    )
                                }
                            }
                            Text(
                                "Estimated net: ${formatter.format(summary.totalIncome - summary.totalExpense)}",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                }
            }
        }
        return
    }

    val monthExpenses = remember(state.allExpenses, selectedMonth) {
        state.allExpenses
            .filter { parseExpenseYearMonth(it.spentAt) == selectedMonth }
            .sortedByDescending { it.spentAt }
    }
    val monthCategorySpend = remember(monthExpenses) {
        monthExpenses
            .groupBy { it.categoryName ?: "Uncategorized" }
            .map { (categoryName, rows) -> CategorySpend(categoryName = categoryName, total = rows.sumOf { it.amount }) }
            .sortedByDescending { it.total }
    }
    val monthSummary = remember(monthSummaries, selectedMonth) {
        monthSummaries.firstOrNull { it.month == selectedMonth }
    }

    LazyColumn(
        state = historyListState,
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
        contentPadding = PaddingValues(bottom = 24.dp)
    ) {
        item {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    selectedMonth.format(DateTimeFormatter.ofPattern("MMMM yyyy")),
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.Bold
                )
                TextButton(onClick = { selectedMonthKey = null }) { Text("All months") }
            }
        }

        item {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                OutlinedButton(onClick = onBack) {
                    Text("Back to account")
                }
                OutlinedButton(onClick = { showCharts = !showCharts }) {
                    Text(if (showCharts) "Hide charts" else "Show charts")
                }
            }
        }

        item {
            val incomeCategories = monthSummary?.incomeCategoryTotals.orEmpty()
            MonthlySummaryCard(
                title = "Summary",
                subtitle = "Entries: ${monthSummary?.expenseCount ?: 0}",
                incomeValue = formatter.format(monthSummary?.totalIncome ?: 0.0),
                expenseValue = formatter.format(monthSummary?.totalExpense ?: 0.0),
                incomeLabel = "Income",
                expenseLabel = "Expense",
                extraContent = {
                    if (incomeCategories.isNotEmpty()) {
                        Spacer(modifier = Modifier.height(6.dp))
                        Text("Income by category", style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.SemiBold)
                        incomeCategories.forEach { incomeCategory ->
                            Text(
                                "${incomeCategory.categoryName}: ${formatter.format(incomeCategory.total)}",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                }
            )
        }

        if (showCharts) {
            item {
                Card {
                    Column(modifier = Modifier.padding(16.dp)) {
                        Text("Spending by category", fontWeight = FontWeight.SemiBold)
                        Spacer(modifier = Modifier.height(10.dp))
                        if (monthCategorySpend.isEmpty()) {
                            EmptyState("No data for charts in this month.")
                        } else {
                            PieChart(
                                values = monthCategorySpend.map { it.total },
                                colors = chartPalette
                            )
                            Spacer(modifier = Modifier.height(12.dp))
                            monthCategorySpend.forEachIndexed { index, item ->
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Box(
                                            modifier = Modifier
                                                .size(10.dp)
                                                .background(chartPalette[index % chartPalette.size], CircleShape)
                                        )
                                        Spacer(modifier = Modifier.width(8.dp))
                                        Text(item.categoryName)
                                    }
                                    Text(formatter.format(item.total), fontWeight = FontWeight.SemiBold)
                                }
                                if (index != monthCategorySpend.lastIndex) {
                                    Spacer(modifier = Modifier.height(6.dp))
                                }
                            }
                        }
                    }
                }
            }
        }

        item {
            Text("Expenses", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        }

        if (monthExpenses.isEmpty()) {
            item {
                EmptyState("No expenses in this month.")
            }
        } else {
            items(monthExpenses, key = { it.id }) { expense ->
                PastExpenseRow(expense = expense, formatter = formatter)
            }
        }
    }
}

@Composable
private fun PastExpenseRow(expense: Expense, formatter: NumberFormat) {
    val colorIndex = expense.id.hashCode().absoluteValue % expensePalette.size
    val background = expensePalette[colorIndex].copy(alpha = 0.18f)

    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = background)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(expense.name, fontWeight = FontWeight.Medium)
                Spacer(modifier = Modifier.height(3.dp))
                Text(
                    text = "${expense.categoryName ?: "Uncategorized"} | ${expense.spentByName ?: "Member"}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            Column(horizontalAlignment = Alignment.End) {
                Text(
                    text = formatter.format(expense.amount),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold
                )
                Text(
                    text = formatDateTime(expense.spentAt),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}

@Composable
private fun InsightsHubTab(
    modifier: Modifier,
    state: AppUiState,
    selectedView: InsightsView,
    onViewChange: (InsightsView) -> Unit,
    onAddIncome: (String, String?, Double, Int) -> Unit,
    onToggleIncome: (Income) -> Unit,
    onUpdateIncome: (Income, String, String?, Double, Int, Boolean) -> Unit,
    onAddIncomeCategory: (String) -> Unit
) {
    Column(
        modifier = modifier.fillMaxSize()
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 10.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            InsightsView.values().forEach { view ->
                val selected = view == selectedView
                OutlinedButton(
                    onClick = { onViewChange(view) },
                    modifier = Modifier.weight(1f)
                ) {
                    Text(
                        text = view.label,
                        color = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface
                    )
                }
            }
        }

        when (selectedView) {
            InsightsView.OVERVIEW -> MetricsTab(modifier = Modifier.weight(1f), state = state)
            InsightsView.TRENDS -> ChartsTab(modifier = Modifier.weight(1f), state = state)
            InsightsView.INCOME -> IncomeTab(
                modifier = Modifier.weight(1f),
                state = state,
                onAddIncome = onAddIncome,
                onToggleIncome = onToggleIncome,
                onUpdateIncome = onUpdateIncome,
                onAddIncomeCategory = onAddIncomeCategory
            )
        }
    }
}

@Composable
private fun ExpenseRow(expense: Expense, formatter: NumberFormat, onClick: () -> Unit) {
    val colorIndex = expense.id.hashCode().absoluteValue % expensePalette.size
    val background = expensePalette[colorIndex].copy(alpha = 0.18f)

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable { onClick() },
        colors = CardDefaults.cardColors(containerColor = background)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(expense.name, fontWeight = FontWeight.Medium)
                Spacer(modifier = Modifier.height(3.dp))
                Text(
                    text = "${expense.categoryName ?: "Uncategorized"} | ${expense.spentByName ?: "Member"}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            Column(horizontalAlignment = Alignment.End) {
                Text(
                    text = formatter.format(expense.amount),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold
                )
                Text(
                    text = formatDateTime(expense.spentAt),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}

@Composable
private fun MetricsTab(modifier: Modifier, state: AppUiState) {
    val family = state.family ?: return
    val formatter = rememberCurrencyFormatter(family.currencyCode)

    LazyColumn(
        modifier = modifier
            .fillMaxSize()
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
        contentPadding = PaddingValues(bottom = 96.dp)
    ) {
        item {
            BrandWordmark()
        }

        item {
            Text("Metrics", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        }

        item {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                MetricCard(
                    title = "Income",
                    value = formatter.format(state.totalMonthlyIncome),
                    color = MaterialTheme.colorScheme.primaryContainer,
                    modifier = Modifier.weight(1f)
                )
                MetricCard(
                    title = "Expense",
                    value = formatter.format(state.totalMonthlyExpense),
                    color = MaterialTheme.colorScheme.errorContainer,
                    modifier = Modifier.weight(1f)
                )
            }
        }

        item {
            MetricCard(
                title = "Net savings",
                value = formatter.format(state.netSavings),
                color = if (state.netSavings >= 0) MaterialTheme.colorScheme.tertiaryContainer else MaterialTheme.colorScheme.errorContainer,
                modifier = Modifier.fillMaxWidth()
            )
        }

        item {
            Text("Yearly (current year)", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        }

        item {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                MetricCard(
                    title = "Income",
                    value = formatter.format(state.totalYearlyIncome),
                    color = MaterialTheme.colorScheme.primaryContainer,
                    modifier = Modifier.weight(1f)
                )
                MetricCard(
                    title = "Expense",
                    value = formatter.format(state.totalYearlyExpense),
                    color = MaterialTheme.colorScheme.errorContainer,
                    modifier = Modifier.weight(1f)
                )
            }
        }

        item {
            MetricCard(
                title = "Yearly net",
                value = formatter.format(state.yearlyNetSavings),
                color = if (state.yearlyNetSavings >= 0) MaterialTheme.colorScheme.tertiaryContainer else MaterialTheme.colorScheme.errorContainer,
                modifier = Modifier.fillMaxWidth()
            )
        }

        item {
            Text("Who spent how much", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        }

        if (state.memberSpend.isEmpty()) {
            item { EmptyState("No spending data yet.") }
        } else {
            items(state.memberSpend.size, key = { index -> state.memberSpend[index].memberName }) { index ->
                val item = state.memberSpend[index]
                Card {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(12.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(item.memberName, fontWeight = FontWeight.Medium)
                        Text(formatter.format(item.total), fontWeight = FontWeight.SemiBold)
                    }
                }
            }
        }
    }
}

@Composable
private fun MetricCard(title: String, value: String, color: Color, modifier: Modifier) {
    Card(modifier = modifier, colors = CardDefaults.cardColors(containerColor = color)) {
        Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(title, color = MaterialTheme.colorScheme.onSurface)
            Text(value, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        }
    }
}

@Composable
private fun SummaryValueRow(
    label: String,
    value: String,
    valueColor: Color
) {
    Row(
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        Text(
            text = value,
            style = MaterialTheme.typography.titleSmall,
            fontWeight = FontWeight.SemiBold,
            color = valueColor
        )
    }
}

@Composable
private fun MonthlySummaryCard(
    title: String,
    subtitle: String?,
    incomeValue: String,
    expenseValue: String,
    incomeLabel: String = "Income",
    expenseLabel: String = "Expense",
    extraContent: (@Composable () -> Unit)? = null
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.35f)
        )
    ) {
        Column(modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column(
                    modifier = Modifier.weight(1f),
                    verticalArrangement = Arrangement.spacedBy(2.dp)
                ) {
                    Text(
                        text = title,
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.SemiBold
                    )
                    if (!subtitle.isNullOrBlank()) {
                        Text(
                            text = subtitle,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }

                Column(
                    horizontalAlignment = Alignment.End,
                    verticalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    SummaryValueRow(
                        label = incomeLabel,
                        value = incomeValue,
                        valueColor = MaterialTheme.colorScheme.primary
                    )
                    SummaryValueRow(
                        label = expenseLabel,
                        value = expenseValue,
                        valueColor = MaterialTheme.colorScheme.error
                    )
                }
            }

            if (extraContent != null) {
                extraContent()
            }
        }
    }
}

@Composable
private fun ChartsTab(modifier: Modifier, state: AppUiState) {
    val family = state.family ?: return
    val formatter = rememberCurrencyFormatter(family.currencyCode)

    LazyColumn(
        modifier = modifier
            .fillMaxSize()
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
        contentPadding = PaddingValues(bottom = 96.dp)
    ) {
        item {
            BrandWordmark()
        }

        item {
            Text("Charts", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        }

        item {
            Card {
                Column(modifier = Modifier.padding(16.dp)) {
                    Text("Spending by category", fontWeight = FontWeight.SemiBold)
                    Spacer(modifier = Modifier.height(10.dp))
                    if (state.categorySpend.isEmpty()) {
                        EmptyState("Add expenses to view pie chart")
                    } else {
                        PieChart(
                            values = state.categorySpend.map { it.total },
                            colors = chartPalette
                        )

                        Spacer(modifier = Modifier.height(12.dp))
                        state.categorySpend.forEachIndexed { index, item ->
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Box(
                                        modifier = Modifier
                                            .size(10.dp)
                                            .background(chartPalette[index % chartPalette.size], CircleShape)
                                    )
                                    Spacer(modifier = Modifier.width(8.dp))
                                    Text(item.categoryName)
                                }
                                Text(formatter.format(item.total), fontWeight = FontWeight.SemiBold)
                            }
                            if (index != state.categorySpend.lastIndex) {
                                Spacer(modifier = Modifier.height(6.dp))
                            }
                        }
                    }
                }
            }
        }

        item {
            Card {
                Column(modifier = Modifier.padding(16.dp)) {
                    Text("Spend share by member", fontWeight = FontWeight.SemiBold)
                    Spacer(modifier = Modifier.height(8.dp))
                    if (state.memberSpend.isEmpty()) {
                        EmptyState("No member spend data yet")
                    } else {
                        val total = state.memberSpend.sumOf { it.total }.coerceAtLeast(0.01)
                        state.memberSpend.forEachIndexed { index, item ->
                            val ratio = (item.total / total).toFloat().coerceIn(0f, 1f)
                            val trackColor = MaterialTheme.colorScheme.surfaceVariant
                            Text(item.memberName)
                            Spacer(modifier = Modifier.height(4.dp))
                            Canvas(modifier = Modifier
                                .fillMaxWidth()
                                .height(12.dp)) {
                                drawLine(
                                    color = trackColor,
                                    start = Offset(0f, size.height / 2),
                                    end = Offset(size.width, size.height / 2),
                                    strokeWidth = size.height,
                                    cap = StrokeCap.Round
                                )
                                drawLine(
                                    color = chartPalette[index % chartPalette.size],
                                    start = Offset(0f, size.height / 2),
                                    end = Offset(size.width * ratio, size.height / 2),
                                    strokeWidth = size.height,
                                    cap = StrokeCap.Round
                                )
                            }
                            Text(
                                "${(ratio * 100).roundToInt()}% | ${formatter.format(item.total)}",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                            Spacer(modifier = Modifier.height(10.dp))
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun PieChart(values: List<Double>, colors: List<Color>) {
    val total = values.sum().coerceAtLeast(0.01)

    Canvas(modifier = Modifier
        .fillMaxWidth()
        .height(220.dp)) {
        val diameter = size.minDimension * 0.8f
        val topLeft = Offset((size.width - diameter) / 2, (size.height - diameter) / 2)
        val arcSize = Size(diameter, diameter)

        var startAngle = -90f
        values.forEachIndexed { index, value ->
            val sweep = ((value / total) * 360f).toFloat()
            drawArc(
                color = colors[index % colors.size],
                startAngle = startAngle,
                sweepAngle = sweep,
                useCenter = false,
                topLeft = topLeft,
                size = arcSize,
                style = Stroke(width = 62f)
            )
            startAngle += sweep
        }
    }
}

@Composable
private fun IncomeTab(
    modifier: Modifier,
    state: AppUiState,
    onAddIncome: (String, String?, Double, Int) -> Unit,
    onToggleIncome: (Income) -> Unit,
    onUpdateIncome: (Income, String, String?, Double, Int, Boolean) -> Unit,
    onAddIncomeCategory: (String) -> Unit
) {
    var showAddDialog by rememberSaveable { mutableStateOf(false) }
    var editingIncome by remember { mutableStateOf<Income?>(null) }
    var showIncomeCategoryPicker by rememberSaveable { mutableStateOf(false) }

    if (showAddDialog) {
        IncomeDialog(
            title = "Add monthly income",
            categories = state.incomeCategories,
            onAddCategory = onAddIncomeCategory,
            onDismiss = { showAddDialog = false },
            onSubmit = { title, categoryId, amount, day, _ ->
                onAddIncome(title, categoryId, amount, day)
                showAddDialog = false
            }
        )
    }

    editingIncome?.let { income ->
        IncomeDialog(
            title = "Edit income",
            existing = income,
            categories = state.incomeCategories,
            onAddCategory = onAddIncomeCategory,
            onDismiss = { editingIncome = null },
            onSubmit = { title, categoryId, amount, day, active ->
                onUpdateIncome(income, title, categoryId, amount, day, active)
                editingIncome = null
            }
        )
    }

    if (showIncomeCategoryPicker) {
        CategoryPicker(
            title = "Income categories",
            categories = state.incomeCategories,
            allowUncategorized = false,
            onSelected = { showIncomeCategoryPicker = false },
            onAddCategory = onAddIncomeCategory,
            onDismiss = { showIncomeCategoryPicker = false }
        )
    }

    val family = state.family ?: return
    val formatter = rememberCurrencyFormatter(family.currencyCode)

    LazyColumn(
        modifier = modifier
            .fillMaxSize()
            .padding(horizontal = 16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
        contentPadding = PaddingValues(top = 14.dp, bottom = 96.dp)
    ) {
        item {
            BrandWordmark()
        }

        item {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text("Recurring Income", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                IconButton(onClick = { showAddDialog = true }) {
                    Icon(Icons.Default.Add, contentDescription = "Add income")
                }
            }
        }

        item {
            Text(
                "Recurring income resets monthly. You can add income any day and it will count in monthly totals.",
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }

        item {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text("Income categories", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                TextButton(onClick = { showIncomeCategoryPicker = true }) {
                    Text("Manage")
                }
            }
        }

        if (state.incomes.isEmpty()) {
            item { EmptyState("No income entries yet. Tap + to add.") }
        } else {
            items(state.incomes, key = { it.id }) { income ->
                Card(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { editingIncome = income }
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(12.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(income.title, fontWeight = FontWeight.SemiBold)
                            Text(
                                "${income.categoryName ?: "Uncategorized"} | Every month on day ${income.dayOfMonth}",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                        Column(horizontalAlignment = Alignment.End) {
                            Text(formatter.format(income.amount), fontWeight = FontWeight.SemiBold)
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text("Active", style = MaterialTheme.typography.bodySmall)
                                Switch(
                                    checked = income.isActive,
                                    onCheckedChange = { onToggleIncome(income) }
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun AddExpenseDialog(
    categories: List<Category>,
    topCategoryIds: List<String> = emptyList(),
    onAddCategory: (String) -> Unit,
    existing: Expense?,
    onDismiss: () -> Unit,
    onSubmit: (name: String, categoryId: String?, amount: Double, notes: String?) -> Unit,
    onDelete: (() -> Unit)? = null
) {
    var name by rememberSaveable(existing?.id) { mutableStateOf(existing?.name ?: "") }
    var amount by rememberSaveable(existing?.id) { mutableStateOf(existing?.amount?.toString() ?: "") }
    var notes by rememberSaveable(existing?.id) { mutableStateOf(existing?.notes ?: "") }
    var selectedCategoryId by rememberSaveable(existing?.id) { mutableStateOf(existing?.categoryId) }
    var categoryQuery by rememberSaveable(existing?.id) { mutableStateOf(existing?.categoryName ?: "") }
    var showCategorySuggestions by remember { mutableStateOf(false) }
    var categoryFieldWidthPx by remember { mutableStateOf(0) }
    var showCategoryPicker by rememberSaveable(existing?.id) { mutableStateOf(false) }
    var showDeleteConfirm by rememberSaveable(existing?.id) { mutableStateOf(false) }
    var showCreateCategoryConfirm by rememberSaveable(existing?.id) { mutableStateOf(false) }
    val categorySuggestionsListState = rememberLazyListState()
    val density = LocalDensity.current
    val categoryMenuModifier = if (categoryFieldWidthPx > 0) {
        Modifier.width(with(density) { categoryFieldWidthPx.toDp() })
    } else {
        Modifier
    }
    val topRank = remember(topCategoryIds) {
        topCategoryIds.withIndex().associate { indexed -> indexed.value to indexed.index }
    }
    val rankedCategories = remember(categories, topRank) {
        categories.sortedWith(
            compareBy<Category>(
                { category -> topRank[category.id] ?: Int.MAX_VALUE },
                { category -> category.name.lowercase() }
            )
        )
    }
    val topCategoriesForUser = remember(rankedCategories, topRank) {
        rankedCategories
            .filter { category -> topRank.containsKey(category.id) }
            .take(3)
    }
    val categorySuggestions = remember(rankedCategories, categoryQuery) {
        val query = categoryQuery.trim()
        if (query.isBlank()) {
            rankedCategories
        } else {
            rankedCategories
                .filter { it.name.contains(query, ignoreCase = true) }
        }
    }
    val hasExactCategoryMatch = categories.any { category ->
        category.name.equals(categoryQuery.trim(), ignoreCase = true)
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (existing == null) "Add expense" else "Edit expense") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedTextField(
                    value = amount,
                    onValueChange = { amount = it },
                    label = { Text("Amount (quick add)") },
                    modifier = Modifier.fillMaxWidth()
                )
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it },
                    label = { Text("Expense name (optional)") },
                    modifier = Modifier.fillMaxWidth()
                )

                Box(modifier = Modifier.fillMaxWidth()) {
                    OutlinedTextField(
                        value = categoryQuery,
                        onValueChange = { value ->
                            categoryQuery = value
                            selectedCategoryId = categories.firstOrNull {
                                it.name.equals(value.trim(), ignoreCase = true)
                            }?.id
                            showCategorySuggestions = true
                        },
                        label = { Text("Category (search)") },
                        modifier = Modifier
                            .fillMaxWidth()
                            .onGloballyPositioned { coordinates ->
                                categoryFieldWidthPx = coordinates.size.width
                            }
                            .onFocusChanged { focusState ->
                                if (focusState.isFocused) {
                                    showCategorySuggestions = true
                                }
                            },
                        singleLine = true
                    )
                    DropdownMenu(
                        expanded = showCategorySuggestions && categorySuggestions.isNotEmpty(),
                        onDismissRequest = { showCategorySuggestions = false },
                        modifier = categoryMenuModifier
                    ) {
                        Box(
                            modifier = Modifier
                                .heightIn(max = 280.dp)
                                .fillMaxWidth()
                        ) {
                            LazyColumn(
                                state = categorySuggestionsListState,
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(end = 8.dp)
                            ) {
                                if (categoryQuery.isBlank() && topCategoriesForUser.isNotEmpty()) {
                                    item {
                                        Text(
                                            "Most used by you",
                                            style = MaterialTheme.typography.bodySmall,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                                            modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp)
                                        )
                                    }
                                }

                                items(categorySuggestions, key = { it.id }) { category ->
                                    DropdownMenuItem(
                                        text = { Text(category.name) },
                                        onClick = {
                                            selectedCategoryId = category.id
                                            categoryQuery = category.name
                                            showCategorySuggestions = false
                                        }
                                    )
                                }
                            }

                            ExpenseListScrollIndicator(
                                listState = categorySuggestionsListState,
                                modifier = Modifier
                                    .align(Alignment.CenterEnd)
                                    .padding(vertical = 6.dp)
                            )
                        }
                    }
                }

                if (selectedCategoryId == null && categoryQuery.isNotBlank() && !hasExactCategoryMatch) {
                    Text(
                        "No exact category match. Pick a suggestion or use Manage categories.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    TextButton(onClick = {
                        selectedCategoryId = null
                        categoryQuery = ""
                    }) {
                        Text("Use uncategorized")
                    }
                    TextButton(onClick = { showCategoryPicker = true }) {
                        Text("Manage categories")
                    }
                }

                if (showCategoryPicker) {
                    CategoryPicker(
                        title = "Expense categories",
                        categories = categories,
                        allowUncategorized = true,
                        onSelected = { categoryId ->
                            selectedCategoryId = categoryId
                            categoryQuery = categories.firstOrNull { category -> category.id == categoryId }?.name ?: ""
                            showCategoryPicker = false
                        },
                        onAddCategory = onAddCategory,
                        onDismiss = { showCategoryPicker = false }
                    )
                }

                OutlinedTextField(
                    value = notes,
                    onValueChange = { notes = it },
                    label = { Text("Notes (optional)") },
                    modifier = Modifier.fillMaxWidth()
                )
            }
        },
        confirmButton = {
            TextButton(
                onClick = {
                    val parsed = amount.toDoubleOrNull()
                    if (parsed != null && parsed > 0.0) {
                        val categoryCandidate = categoryQuery.trim()
                        val exactCategoryId = categories.firstOrNull { category ->
                            category.name.equals(categoryCandidate, ignoreCase = true)
                        }?.id
                        val finalName = name.trim()
                            .ifBlank { categoryCandidate.ifBlank { "Expense" } }

                        if (categoryCandidate.isNotBlank() && exactCategoryId == null && selectedCategoryId == null) {
                            showCreateCategoryConfirm = true
                            return@TextButton
                        }

                        onSubmit(
                            finalName,
                            exactCategoryId ?: selectedCategoryId,
                            parsed,
                            notes.takeIf { it.isNotBlank() }
                        )
                    }
                }
            ) {
                Text(if (existing == null) "Save" else "Update")
            }
        },
        dismissButton = {
            Row {
                if (existing != null && onDelete != null) {
                    TextButton(onClick = { showDeleteConfirm = true }) {
                        Text("Delete")
                    }
                }
                TextButton(onClick = onDismiss) {
                    Text("Cancel")
                }
            }
        }
    )

    if (showDeleteConfirm && existing != null && onDelete != null) {
        AlertDialog(
            onDismissRequest = { showDeleteConfirm = false },
            title = { Text("Delete expense?") },
            text = { Text("This action cannot be undone.") },
            confirmButton = {
                TextButton(onClick = {
                    onDelete()
                    showDeleteConfirm = false
                }) {
                    Text("Delete")
                }
            },
            dismissButton = {
                TextButton(onClick = { showDeleteConfirm = false }) {
                    Text("Cancel")
                }
            }
        )
    }

    if (showCreateCategoryConfirm) {
        AlertDialog(
            onDismissRequest = { showCreateCategoryConfirm = false },
            title = { Text("Category not found") },
            text = {
                Text("Create \"$categoryQuery\" as a new category before saving this expense?")
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        val candidate = categoryQuery.trim()
                        if (candidate.isNotBlank()) {
                            onAddCategory(candidate)
                        }
                        showCreateCategoryConfirm = false
                    }
                ) {
                    Text("Create category")
                }
            },
            dismissButton = {
                TextButton(
                    onClick = {
                        val parsed = amount.toDoubleOrNull()
                        if (parsed != null && parsed > 0.0) {
                            val finalName = name.trim()
                                .ifBlank { categoryQuery.trim().ifBlank { "Expense" } }
                            onSubmit(
                                finalName,
                                null,
                                parsed,
                                notes.takeIf { it.isNotBlank() }
                            )
                        }
                        showCreateCategoryConfirm = false
                    }
                ) {
                    Text("Use uncategorized")
                }
            }
        )
    }
}

@Composable
private fun CategoryPicker(
    title: String,
    categories: List<Category>,
    allowUncategorized: Boolean,
    onSelected: (String?) -> Unit,
    onAddCategory: (String) -> Unit,
    onDismiss: () -> Unit
) {
    var newCategory by rememberSaveable { mutableStateOf("") }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    OutlinedTextField(
                        value = newCategory,
                        onValueChange = { newCategory = it },
                        label = { Text("New category") },
                        modifier = Modifier.weight(1f)
                    )
                    Button(onClick = {
                        val candidate = newCategory.trim()
                        if (candidate.isNotBlank()) {
                            onAddCategory(candidate)
                            newCategory = ""
                        }
                    }) {
                        Text("Add")
                    }
                }

                LazyColumn(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(260.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    if (allowUncategorized) {
                        item {
                            TextButton(onClick = { onSelected(null) }, modifier = Modifier.fillMaxWidth()) {
                                Text("Uncategorized")
                            }
                        }
                    }
                    items(categories, key = { it.id }) { category ->
                        TextButton(onClick = { onSelected(category.id) }, modifier = Modifier.fillMaxWidth()) {
                            Text(category.name)
                        }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) {
                Text("Close")
            }
        }
    )
}

@Composable
private fun IncomeDialog(
    title: String,
    categories: List<Category>,
    onAddCategory: (String) -> Unit,
    existing: Income? = null,
    onDismiss: () -> Unit,
    onSubmit: (title: String, categoryId: String?, amount: Double, dayOfMonth: Int, active: Boolean) -> Unit
) {
    var incomeTitle by rememberSaveable(existing?.id) { mutableStateOf(existing?.title ?: "") }
    var selectedCategoryId by rememberSaveable(existing?.id) { mutableStateOf(existing?.categoryId) }
    var amount by rememberSaveable(existing?.id) { mutableStateOf(existing?.amount?.toString() ?: "") }
    var dayOfMonth by rememberSaveable(existing?.id) { mutableStateOf((existing?.dayOfMonth ?: 1).toString()) }
    var active by rememberSaveable(existing?.id) { mutableStateOf(existing?.isActive ?: true) }
    var showCategoryPicker by rememberSaveable(existing?.id) { mutableStateOf(false) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedTextField(
                    value = incomeTitle,
                    onValueChange = { incomeTitle = it },
                    label = { Text("Income source") },
                    modifier = Modifier.fillMaxWidth()
                )
                OutlinedButton(
                    onClick = { showCategoryPicker = true },
                    modifier = Modifier.fillMaxWidth()
                ) {
                    val selected = categories.firstOrNull { it.id == selectedCategoryId }?.name ?: "Select income category"
                    Text(selected)
                }
                OutlinedTextField(
                    value = amount,
                    onValueChange = { amount = it },
                    label = { Text("Amount") },
                    modifier = Modifier.fillMaxWidth()
                )
                OutlinedTextField(
                    value = dayOfMonth,
                    onValueChange = { dayOfMonth = it.filter { char -> char.isDigit() }.take(2) },
                    label = { Text("Day of month (1-28)") },
                    modifier = Modifier.fillMaxWidth()
                )
                if (existing != null) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Text("Active")
                        Switch(checked = active, onCheckedChange = { active = it })
                    }
                }

                if (showCategoryPicker) {
                    CategoryPicker(
                        title = "Income categories",
                        categories = categories,
                        allowUncategorized = false,
                        onSelected = {
                            selectedCategoryId = it
                            showCategoryPicker = false
                        },
                        onAddCategory = onAddCategory,
                        onDismiss = { showCategoryPicker = false }
                    )
                }
            }
        },
        confirmButton = {
            TextButton(
                onClick = {
                    val parsedAmount = amount.toDoubleOrNull()
                    val parsedDay = dayOfMonth.toIntOrNull()?.coerceIn(1, 28)
                    if (incomeTitle.isNotBlank() && parsedAmount != null && parsedDay != null) {
                        onSubmit(incomeTitle, selectedCategoryId, parsedAmount, parsedDay, active)
                    }
                }
            ) {
                Text("Save")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Cancel")
            }
        }
    )
}

@Composable
private fun TextInputDialog(
    title: String,
    label: String,
    initial: String,
    onDismiss: () -> Unit,
    onConfirm: (String) -> Unit
) {
    var value by rememberSaveable { mutableStateOf(initial) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            OutlinedTextField(
                value = value,
                onValueChange = { value = it },
                label = { Text(label) },
                modifier = Modifier.fillMaxWidth()
            )
        },
        confirmButton = {
            TextButton(onClick = {
                if (value.isNotBlank()) {
                    onConfirm(value)
                }
            }) { Text("Add") }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Cancel") }
        }
    )
}

@Composable
private fun BrandWordmark(
    modifier: Modifier = Modifier,
    style: androidx.compose.ui.text.TextStyle = MaterialTheme.typography.titleLarge
) {
    val funkyStyle = style.copy(fontFamily = FontFamily.Cursive)
    Text(
        text = stringResource(id = R.string.brand_name),
        modifier = modifier.fillMaxWidth(),
        style = funkyStyle,
        fontWeight = FontWeight.Bold,
        color = MaterialTheme.colorScheme.primary,
        textAlign = TextAlign.Center
    )
}

@Composable
private fun EmptyState(text: String) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.35f))
    ) {
        Text(
            text = text,
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            textAlign = TextAlign.Center,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}

@Composable
private fun rememberCurrencyFormatter(currencyCode: String): NumberFormat {
    return remember(currencyCode) {
        NumberFormat.getCurrencyInstance().apply {
            currency = runCatching { Currency.getInstance(currencyCode) }.getOrElse { Currency.getInstance("INR") }
            maximumFractionDigits = 2
        }
    }
}

private fun formatDateTime(value: String): String {
    return try {
        OffsetDateTime.parse(value).format(DateTimeFormatter.ofPattern("dd MMM yyyy"))
    } catch (_: DateTimeParseException) {
        try {
            LocalDateTime.parse(value).format(DateTimeFormatter.ofPattern("dd MMM yyyy"))
        } catch (_: DateTimeParseException) {
            "-"
        }
    }
}

private fun parseExpenseYearMonth(isoValue: String): YearMonth? {
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

private fun buildMonthSummaries(expenses: List<Expense>, incomes: List<Income>): List<MonthSummary> {
    return expenses
        .groupBy { parseExpenseYearMonth(it.spentAt) }
        .mapNotNull { (month, rows) ->
            month?.let {
                val effectiveIncomes = incomes.filter { income ->
                    income.isActive && isIncomeEffectiveForMonth(income, month)
                }
                MonthSummary(
                    month = month,
                    totalExpense = rows.sumOf { expense -> expense.amount },
                    totalIncome = effectiveIncomes.sumOf { income -> income.amount },
                    expenseCount = rows.size,
                    incomeCategoryTotals = effectiveIncomes
                        .groupBy { income -> income.categoryName ?: "Uncategorized" }
                        .map { (categoryName, incomeRows) ->
                            CategorySpend(categoryName = categoryName, total = incomeRows.sumOf { income -> income.amount })
                        }
                        .sortedByDescending { it.total }
                )
            }
        }
        .sortedByDescending { it.month }
}

private fun isIncomeEffectiveForMonth(income: Income, month: YearMonth): Boolean {
    val createdAt = income.createdAt ?: return true
    val createdMonth = parseExpenseYearMonth(createdAt) ?: return true
    return !createdMonth.isAfter(month)
}

private data class TabMeta(
    val tab: AppTab,
    val icon: androidx.compose.ui.graphics.vector.ImageVector
)

private data class MonthSummary(
    val month: YearMonth,
    val totalExpense: Double,
    val totalIncome: Double,
    val expenseCount: Int,
    val incomeCategoryTotals: List<CategorySpend>
)

private enum class InsightsView(val label: String) {
    OVERVIEW("Overview"),
    TRENDS("Trends"),
    INCOME("Income")
}

private enum class ExpenseSortOption(val label: String) {
    DATE("Date"),
    CATEGORY("Category"),
    PERSON("Person")
}

private val tabMeta = listOf(
    TabMeta(AppTab.Home, Icons.Default.Home),
    TabMeta(AppTab.Insights, Icons.Default.BarChart),
    TabMeta(AppTab.Account, Icons.Default.AccountCircle)
)

private val chartPalette = listOf(
    Color(0xFF5E7CE2),
    Color(0xFF2EB67D),
    Color(0xFFE3B341),
    Color(0xFFE5484D),
    Color(0xFF8E6CFF),
    Color(0xFF00A6D6)
)

private val expensePalette = listOf(
    Color(0xFF8EC5FF),
    Color(0xFF95E3B4),
    Color(0xFFFFD09B),
    Color(0xFFFFA5A5),
    Color(0xFFC7B8FF),
    Color(0xFF9FE5EE)
)
