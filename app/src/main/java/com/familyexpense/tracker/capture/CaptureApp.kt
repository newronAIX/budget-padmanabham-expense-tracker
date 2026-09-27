package com.familyexpense.tracker.capture

import android.Manifest
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn

import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CaptureApp(vm: CaptureViewModel) {
    val state by vm.state.collectAsState()
    val snackbar = remember { SnackbarHostState() }

    val permission = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted -> vm.onSmsPermission(granted) }

    // Ask only once we are actually unlocked. Asking on launch, before the user
    // has seen what the app is for, is how permission prompts get denied.
    LaunchedEffect(state.stage) {
        if (state.stage == Stage.READY) permission.launch(Manifest.permission.READ_SMS)
    }

    LaunchedEffect(state.error, state.notice) {
        val msg = state.error ?: state.notice
        if (msg != null) { snackbar.showSnackbar(msg); vm.clearMessages() }
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbar) },
        topBar = {
            if (state.stage == Stage.READY) {
                TopAppBar(
                    title = { Text("Budget Padmanabham") },
                    actions = {
                        TextButton(onClick = { vm.scanSms() }) { Text("Check SMS") }
                        TextButton(onClick = { vm.signOut() }) { Text("Sign out") }
                    }
                )
            }
        }
    ) { pad ->
        Box(Modifier.padding(pad)) {
            when (state.stage) {
                Stage.LOADING -> Box(Modifier.fillMaxSize(), Alignment.Center) { CircularProgressIndicator() }
                Stage.SIGNED_OUT -> SignInScreen(onSignIn = vm::signIn)
                Stage.NO_FAMILY -> JoinScreen(state.busy, vm::join)
                Stage.LOCKED -> UnlockScreen(state.busy, vm::unlock)
                Stage.READY -> ReadyScreen(state, vm, onAskPermission = {
                    permission.launch(Manifest.permission.READ_SMS)
                })
            }
        }
    }
}

@Composable
private fun ReadyScreen(state: UiState, vm: CaptureViewModel, onAskPermission: () -> Unit) {
    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp)) {

        if (state.needsSmsPermission) {
            item {
                ElevatedCard(Modifier.fillMaxWidth().padding(vertical = 12.dp)) {
                    Column(Modifier.padding(16.dp)) {
                        Text("Let the app read your bank messages", fontWeight = FontWeight.Bold)
                        Spacer(Modifier.height(6.dp))
                        Text(
                            "It only looks at messages from banks, and only to spot payments. " +
                                "Nothing is saved or sent anywhere, and you approve every entry yourself.",
                            style = MaterialTheme.typography.bodyMedium
                        )
                        Spacer(Modifier.height(12.dp))
                        Button(onClick = onAskPermission) { Text("Allow") }
                    }
                }
            }
        }

        if (state.review.isNotEmpty()) {
            item {
                Text(
                    "To review (${state.review.size})",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.padding(top = 14.dp, bottom = 4.dp)
                )
            }
            itemsIndexed(state.review) { i, card ->
                ReviewCardItem(
                    card = card,
                    categories = state.categories,
                    onConfirm = { vm.confirm(i) },
                    onDismiss = { vm.dismiss(i) },
                    onEdit = { t, a, c -> vm.editCard(i, t, a, c) },
                    onSplit = { vm.splitGroup(i) }
                )
            }
        } else {
            item {
                Column(Modifier.fillMaxWidth().padding(vertical = 28.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("Nothing to review", fontWeight = FontWeight.Bold)
                    Spacer(Modifier.height(4.dp))
                    Text(
                        state.lastScanSummary ?: "Tap Check SMS to look for new payments.",
                        style = MaterialTheme.typography.bodySmall
                    )
                }
            }
        }

        item {
            Text(
                "Recent expenses",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.padding(top = 18.dp, bottom = 4.dp)
            )
        }
        items(state.expenses.take(50)) { e ->
            ExpenseRowItem(e, state.categories.firstOrNull { it.id == e.categoryId }?.name)
        }
        item { Spacer(Modifier.height(32.dp)) }
    }
}
