package com.familyexpense.tracker.capture

import android.Manifest
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn

import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.fragment.app.FragmentActivity

/**
 * Everything the UI can ask for, as plain lambdas.
 *
 * Keeping [CaptureScaffold] free of the ViewModel is what lets a UI test drive
 * the navigation with a made-up [UiState] -- no Supabase session, no family
 * password, no SMS on the device.
 */
class CaptureActions(
    val signIn: () -> Unit = {},
    val join: (String, String, String) -> Unit = { _, _, _ -> },
    val unlock: (password: String, remember: Boolean) -> Unit = { _, _ -> },
    val useDeviceLock: () -> Unit = {},
    val usePasswordInstead: () -> Unit = {},
    val selectTab: (Tab) -> Unit = {},
    val scan: () -> Unit = {},
    val signOut: () -> Unit = {},
    val askPermission: () -> Unit = {},
    val confirm: (Int) -> Unit = {},
    val dismiss: (Int) -> Unit = {},
    val edit: (Int, String, Double, String?) -> Unit = { _, _, _, _ -> },
    val split: (Int) -> Unit = {},
    val startUpdate: () -> Unit = {},
    val dismissUpdate: () -> Unit = {}
)

@Composable
fun CaptureApp(vm: CaptureViewModel, activity: FragmentActivity) {
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

    val actions = remember(vm, activity) {
        CaptureActions(
            signIn = vm::signIn,
            join = vm::join,
            unlock = vm::unlock,
            // The prompt is the only part that needs an Activity; the ViewModel
            // stays free of it, and of anything that can only exist on a device.
            useDeviceLock = {
                DeviceUnlock.prompt(
                    activity,
                    onSuccess = { vm.unlockWithDeviceLock() },
                    onUsePassword = { vm.usePasswordInstead() }
                )
            },
            usePasswordInstead = vm::usePasswordInstead,
            selectTab = vm::selectTab,
            scan = vm::scanSms,
            signOut = vm::signOut,
            askPermission = { permission.launch(Manifest.permission.READ_SMS) },
            confirm = vm::confirm,
            dismiss = vm::dismiss,
            edit = vm::editCard,
            split = vm::splitGroup,
            startUpdate = vm::startUpdate,
            dismissUpdate = vm::dismissUpdate
        )
    }

    CaptureScaffold(state, actions, snackbar)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CaptureScaffold(
    state: UiState,
    actions: CaptureActions,
    snackbar: SnackbarHostState = remember { SnackbarHostState() }
) {
    Scaffold(
        snackbarHost = { SnackbarHost(snackbar) },
        bottomBar = {
            if (state.stage == Stage.READY) {
                NavigationBar {
                    NavigationBarItem(
                        selected = state.tab == Tab.HOME,
                        onClick = { actions.selectTab(Tab.HOME) },
                        icon = { Icon(Icons.Filled.Home, contentDescription = null) },
                        label = { Text("Home") }
                    )
                    val pending = state.review.size
                    NavigationBarItem(
                        // Material3 wraps a navigation item's icon in
                        // clearAndSetSemantics, so the badge's digits never reach
                        // a screen reader. Say the count on the item itself.
                        modifier = if (pending > 0) {
                            Modifier.semantics { stateDescription = "$pending waiting" }
                        } else Modifier,
                        selected = state.tab == Tab.REVIEW,
                        onClick = { actions.selectTab(Tab.REVIEW) },
                        icon = {
                            // The badge is the point: an unreviewed queue should
                            // be visible from anywhere, not hidden behind a tap.
                            if (pending > 0) {
                                BadgedBox(badge = { Badge { Text("$pending") } }) {
                                    Icon(Icons.Filled.Notifications, contentDescription = null)
                                }
                            } else {
                                Icon(Icons.Filled.Notifications, contentDescription = null)
                            }
                        },
                        label = { Text("To review") }
                    )
                }
            }
        },
        topBar = {
            if (state.stage == Stage.READY) {
                TopAppBar(
                    title = { Text("Budget Padmanabham") },
                    actions = {
                        TextButton(onClick = actions.scan) { Text("Check SMS") }
                        TextButton(onClick = actions.signOut) { Text("Sign out") }
                    }
                )
            }
        }
    ) { pad ->
        Box(Modifier.padding(pad)) {
            when (state.stage) {
                Stage.LOADING -> Box(Modifier.fillMaxSize(), Alignment.Center) { CircularProgressIndicator() }
                Stage.SIGNED_OUT -> SignInScreen(onSignIn = actions.signIn)
                Stage.NO_FAMILY -> JoinScreen(state.busy, actions.join)
                Stage.LOCKED -> UnlockScreen(
                    busy = state.busy,
                    canUseDeviceLock = state.canUseDeviceLock,
                    canRememberKey = state.canRememberKey,
                    onUnlock = actions.unlock,
                    onUseDeviceLock = actions.useDeviceLock,
                    onUsePasswordInstead = actions.usePasswordInstead
                )
                Stage.READY -> when (state.tab) {
                    Tab.HOME -> HomeScreen(state, actions)
                    Tab.REVIEW -> ReviewScreen(state, actions)
                }
            }
        }
    }
}

@Composable
private fun HomeScreen(state: UiState, actions: CaptureActions) {
    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp)) {
        state.update?.let { build ->
            item {
                UpdateBanner(
                    versionName = build.versionName,
                    notes = build.notes,
                    stage = state.updateStage,
                    onUpdate = actions.startUpdate,
                    onDismiss = actions.dismissUpdate
                )
            }
        }
        item {
            Text(
                "Recent expenses",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.padding(top = 14.dp, bottom = 4.dp)
            )
        }
        if (state.expenses.isEmpty()) {
            item {
                Column(Modifier.fillMaxWidth().padding(vertical = 32.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("No expenses yet", fontWeight = FontWeight.Bold)
                    Spacer(Modifier.height(4.dp))
                    Text("Tap Check SMS to find payments from your bank.", style = MaterialTheme.typography.bodySmall)
                }
            }
        }
        items(state.expenses.take(100)) { e ->
            ExpenseRowItem(e, state.categories.firstOrNull { it.id == e.categoryId }?.name)
        }
        item { Spacer(Modifier.height(24.dp)) }
    }
}

@Composable
private fun ReviewScreen(state: UiState, actions: CaptureActions) {
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
                        Button(onClick = actions.askPermission) { Text("Allow") }
                    }
                }
            }
        }

        if (state.review.isEmpty()) {
            item {
                Column(Modifier.fillMaxWidth().padding(vertical = 48.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("Nothing to review", fontWeight = FontWeight.Bold)
                    Spacer(Modifier.height(4.dp))
                    Text(
                        state.lastScanSummary ?: "Tap Check SMS to look for new payments.",
                        style = MaterialTheme.typography.bodySmall
                    )
                    Spacer(Modifier.height(16.dp))
                    OutlinedButton(onClick = { actions.selectTab(Tab.HOME) }) { Text("Back to expenses") }
                }
            }
        } else {
            item {
                Text(
                    "${state.review.size} to review",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.padding(top = 14.dp, bottom = 4.dp)
                )
            }
            itemsIndexed(state.review) { i, card ->
                ReviewCardItem(
                    card = card,
                    categories = state.categories,
                    onConfirm = { actions.confirm(i) },
                    onDismiss = { actions.dismiss(i) },
                    onEdit = { t, a, c -> actions.edit(i, t, a, c) },
                    onSplit = { actions.split(i) }
                )
            }
        }
        item { Spacer(Modifier.height(24.dp)) }
    }
}
