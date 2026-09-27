package com.familyexpense.tracker.capture

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.familyexpense.tracker.backend.Expense
import java.text.NumberFormat
import java.util.Locale

private fun money(v: Double): String =
    NumberFormat.getCurrencyInstance(Locale("en", "IN")).apply { maximumFractionDigits = 0 }.format(v)

@Composable
fun SignInScreen(onSignIn: () -> Unit) {
    Column(
        Modifier.fillMaxSize().padding(28.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Text("Budget Padmanabham", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(8.dp))
        Text(
            "Your family's expense book. Sign in with the same Gmail you use on the website.",
            style = MaterialTheme.typography.bodyLarge
        )
        Spacer(Modifier.height(28.dp))
        Button(onClick = onSignIn, Modifier.fillMaxWidth().height(56.dp)) {
            Text("Continue with Gmail", style = MaterialTheme.typography.titleMedium)
        }
    }
}

@Composable
fun JoinScreen(busy: Boolean, onJoin: (String, String, String) -> Unit) {
    var code by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var name by remember { mutableStateOf("") }
    var show by remember { mutableStateOf(false) }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp)) {
        Text("Join your family", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(6.dp))
        Text(
            "Enter the family code and password someone already in the family gave you.",
            style = MaterialTheme.typography.bodyMedium
        )
        Spacer(Modifier.height(20.dp))
        OutlinedTextField(
            value = code, onValueChange = { code = it.uppercase() },
            label = { Text("Family code") }, placeholder = { Text("BUDGET-XXXXXXX") },
            singleLine = true, modifier = Modifier.fillMaxWidth()
        )
        Spacer(Modifier.height(12.dp))
        OutlinedTextField(
            value = password, onValueChange = { password = it },
            label = { Text("Family password") },
            singleLine = true, modifier = Modifier.fillMaxWidth(),
            visualTransformation = if (show) VisualTransformation.None else PasswordVisualTransformation(),
            trailingIcon = {
                TextButton(onClick = { show = !show }) { Text(if (show) "Hide" else "Show") }
            }
        )
        Spacer(Modifier.height(12.dp))
        OutlinedTextField(
            value = name, onValueChange = { name = it },
            label = { Text("Your name") },
            supportingText = { Text("How your spending shows up to the family.") },
            singleLine = true, modifier = Modifier.fillMaxWidth()
        )
        Spacer(Modifier.height(20.dp))
        Button(
            onClick = { onJoin(code, password, name) },
            enabled = !busy && code.isNotBlank() && password.isNotBlank() && name.isNotBlank(),
            modifier = Modifier.fillMaxWidth().height(52.dp)
        ) { Text(if (busy) "Joining…" else "Join family") }
    }
}

@Composable
fun UnlockScreen(busy: Boolean, onUnlock: (String) -> Unit) {
    var password by remember { mutableStateOf("") }
    var show by remember { mutableStateOf(false) }
    Column(
        Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.Center
    ) {
        Text("Enter your family password", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(6.dp))
        Text(
            "This unlocks your family's entries on this phone. It is never sent anywhere.",
            style = MaterialTheme.typography.bodyMedium
        )
        Spacer(Modifier.height(20.dp))
        OutlinedTextField(
            value = password, onValueChange = { password = it },
            label = { Text("Family password") }, singleLine = true,
            modifier = Modifier.fillMaxWidth(),
            visualTransformation = if (show) VisualTransformation.None else PasswordVisualTransformation(),
            trailingIcon = { TextButton(onClick = { show = !show }) { Text(if (show) "Hide" else "Show") } }
        )
        Spacer(Modifier.height(20.dp))
        Button(
            onClick = { onUnlock(password) },
            enabled = !busy && password.isNotBlank(),
            modifier = Modifier.fillMaxWidth().height(52.dp)
        ) { Text(if (busy) "Checking…" else "Unlock") }
    }
}

@Composable
fun ReviewCardItem(
    card: ReviewCard,
    categories: List<com.familyexpense.tracker.backend.Category>,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
    onEdit: (String, Double, String?) -> Unit
) {
    var editing by remember { mutableStateOf(false) }
    var title by remember(card) { mutableStateOf(card.title) }
    var amount by remember(card) { mutableStateOf(card.amount.toString()) }
    var categoryId by remember(card) { mutableStateOf(card.categoryId) }
    var pickerOpen by remember { mutableStateOf(false) }

    ElevatedCard(Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
        Column(Modifier.padding(16.dp)) {
            Text(card.txn.bank, style = MaterialTheme.typography.labelMedium)
            Spacer(Modifier.height(4.dp))
            if (editing) {
                OutlinedTextField(title, { title = it }, label = { Text("What for") },
                    singleLine = true, modifier = Modifier.fillMaxWidth())
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(amount, { amount = it }, label = { Text("Amount") },
                    singleLine = true, modifier = Modifier.fillMaxWidth(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal))
            } else {
                Text(card.title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold,
                    maxLines = 2, overflow = TextOverflow.Ellipsis)
                Text(money(card.amount), style = MaterialTheme.typography.headlineSmall)
            }
            Spacer(Modifier.height(6.dp))
            Text(card.spentOn, style = MaterialTheme.typography.bodySmall)

            // A wallet or BNPL spend is settled again by the bank, so the same
            // rupee can arrive twice. Say so rather than silently double count.
            if (card.txn.mayDuplicate) {
                Spacer(Modifier.height(8.dp))
                Text(
                    "Your bank may send a separate message for this same payment. Add it once only.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error
                )
            }

            Spacer(Modifier.height(10.dp))
            Box {
                AssistChip(
                    onClick = { pickerOpen = true },
                    label = { Text(categories.firstOrNull { it.id == categoryId }?.name ?: "Choose category") }
                )
                DropdownMenu(pickerOpen, onDismissRequest = { pickerOpen = false }) {
                    categories.filter { it.scope == "EXPENSE" }.forEach { c ->
                        DropdownMenuItem(text = { Text(c.name) }, onClick = {
                            categoryId = c.id; pickerOpen = false
                            onEdit(title, amount.toDoubleOrNull() ?: card.amount, categoryId)
                        })
                    }
                }
            }

            Spacer(Modifier.height(14.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(
                    onClick = {
                        if (editing) onEdit(title, amount.toDoubleOrNull() ?: card.amount, categoryId)
                        onConfirm()
                    },
                    modifier = Modifier.weight(1f)
                ) { Text("Add") }
                OutlinedButton(onClick = {
                    if (editing) onEdit(title, amount.toDoubleOrNull() ?: card.amount, categoryId)
                    editing = !editing
                }) { Text(if (editing) "Done" else "Edit") }
                TextButton(onClick = onDismiss) { Text("Skip") }
            }
        }
    }
}

@Composable
fun ExpenseRowItem(e: Expense, categoryName: String?) {
    ListItem(
        headlineContent = { Text(e.title, maxLines = 1, overflow = TextOverflow.Ellipsis) },
        supportingContent = { Text(listOfNotNull(categoryName, e.spentOn).joinToString(" · ")) },
        trailingContent = { Text(money(e.amount), fontWeight = FontWeight.Bold) }
    )
    HorizontalDivider()
}
