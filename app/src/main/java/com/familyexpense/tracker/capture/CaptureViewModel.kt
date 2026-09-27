package com.familyexpense.tracker.capture

import android.app.Application
import android.net.Uri
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.familyexpense.tracker.auth.AuthManager
import com.familyexpense.tracker.backend.Category
import com.familyexpense.tracker.backend.Expense
import com.familyexpense.tracker.backend.LedgerRepository
import com.familyexpense.tracker.backend.Person
import com.familyexpense.tracker.backend.SupabaseClient
import com.familyexpense.tracker.data.FamilyCrypto
import com.familyexpense.tracker.sms.Direction
import com.familyexpense.tracker.sms.MerchantRules
import com.familyexpense.tracker.sms.ParsedTransaction
import com.familyexpense.tracker.sms.SeenStore
import com.familyexpense.tracker.sms.SmsInbox
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import javax.crypto.SecretKey

/** One detected transaction awaiting the user's yes / edit / no. */
data class ReviewCard(
    val txn: ParsedTransaction,
    val title: String,
    val amount: Double,
    val categoryId: String?,
    val categoryName: String?,
    val spentOn: String,
    val personId: String?
)

enum class Stage { LOADING, SIGNED_OUT, NO_FAMILY, LOCKED, READY }

data class UiState(
    val stage: Stage = Stage.LOADING,
    val busy: Boolean = false,
    val error: String? = null,
    val notice: String? = null,
    val email: String? = null,
    val needsSmsPermission: Boolean = false,
    val review: List<ReviewCard> = emptyList(),
    val expenses: List<Expense> = emptyList(),
    val categories: List<Category> = emptyList(),
    val people: List<Person> = emptyList(),
    val lastScanSummary: String? = null
)

class CaptureViewModel(app: Application) : AndroidViewModel(app) {

    private val api = SupabaseClient()
    private val repo = LedgerRepository(api)
    private val auth = AuthManager(app, api)
    private val seen = SeenStore(app)
    private val inbox = SmsInbox(app)

    private val _state = MutableStateFlow(UiState())
    val state: StateFlow<UiState> = _state.asStateFlow()

    private var accessToken: String? = null
    private var familyId: String? = null
    private var userId: String? = null
    // In memory only, deliberately. See core/Session.kt.
    private var familyKey: SecretKey? = null
    private var encryptionSalt: String? = null
    private var encryptionCheck: String? = null
    private var myPersonId: String? = null

    init { restoreSession() }

    fun signIn() = auth.launchSignIn()

    fun onRedirect(uri: Uri?) {
        val tokens = auth.tokensFromRedirect(uri) ?: return
        viewModelScope.launch {
            auth.persist(tokens.first, tokens.second)
            accessToken = tokens.first
            afterSignIn()
        }
    }

    private fun restoreSession() = viewModelScope.launch {
        val restored = auth.restore()
        if (restored == null) {
            _state.value = _state.value.copy(stage = Stage.SIGNED_OUT)
            return@launch
        }
        accessToken = restored.first
        afterSignIn()
    }

    private suspend fun afterSignIn() {
        val token = accessToken ?: return
        val user = api.currentUser(token)
        userId = user?.id
        _state.value = _state.value.copy(email = user?.email)

        val membership = api.membership(token)
        if (membership == null) {
            _state.value = _state.value.copy(stage = Stage.NO_FAMILY)
            return
        }
        familyId = membership.familyId
        val fam = api.family(token, membership.familyId)
        encryptionSalt = fam?.encryptionSalt
        encryptionCheck = fam?.encryptionCheck
        _state.value = _state.value.copy(stage = Stage.LOCKED)
    }

    /** Unlock an existing family. Verified against encryption_check before use. */
    fun unlock(password: String) = viewModelScope.launch {
        val salt = encryptionSalt
        val check = encryptionCheck
        if (salt == null || check == null) {
            _state.value = _state.value.copy(error = "This family is not set up for encryption yet. Open it on the web app once.")
            return@launch
        }
        _state.value = _state.value.copy(busy = true, error = null)
        val key = withContext(Dispatchers.Default) { FamilyCrypto.verify(password, salt, check) }
        if (key == null) {
            _state.value = _state.value.copy(busy = false, error = "That family password is not correct.")
            return@launch
        }
        familyKey = key
        _state.value = _state.value.copy(busy = false, stage = Stage.READY)
        refresh()
    }

    /**
     * Join with a family code + password -- the web app's one-step flow.
     *
     * Two round trips by necessity: fetch the salt for that code, derive the key
     * locally, then send only the fingerprint. The password itself never leaves
     * the device, and a wrong one is rejected by the server rather than by us.
     */
    fun join(code: String, password: String, displayName: String) = viewModelScope.launch {
        val token = accessToken ?: return@launch
        val normalised = code.trim().uppercase()
        _state.value = _state.value.copy(busy = true, error = null)

        val salt = api.inviteSalt(token, normalised)
        if (salt == null) {
            _state.value = _state.value.copy(
                busy = false,
                error = "That family code is not valid, or the family has stopped accepting new members."
            )
            return@launch
        }

        val key = withContext(Dispatchers.Default) { FamilyCrypto.deriveKey(password, salt) }
        val result = api.joinFamily(token, normalised, displayName.trim(), FamilyCrypto.fingerprint(key))
        result.fold(
            onSuccess = { joinedFamilyId ->
                familyKey = key
                familyId = joinedFamilyId
                encryptionSalt = salt
                _state.value = _state.value.copy(busy = false, stage = Stage.READY, notice = "You are in.")
                refresh()
            },
            onFailure = { e ->
                // The server's own message is the useful one here: it
                // distinguishes a wrong password from a locked family.
                _state.value = _state.value.copy(busy = false, error = e.message ?: "Could not join.")
            }
        )
    }

    fun onSmsPermission(granted: Boolean) {
        _state.value = _state.value.copy(needsSmsPermission = !granted)
        if (granted) scanSms()
    }

    fun scanSms() = viewModelScope.launch {
        val key = familyKey ?: return@launch
        _state.value = _state.value.copy(busy = true)
        val already = seen.all()
        val result = withContext(Dispatchers.IO) {
            inbox.scan(SmsInbox.defaultSince(System.currentTimeMillis()), already)
        }
        val cards = result.transactions
            // Credits are income, not spending; this app only captures expenses.
            .filter { it.direction == Direction.DEBIT }
            .map { toCard(it) }
        _state.value = _state.value.copy(
            busy = false,
            review = cards,
            lastScanSummary = "Checked ${result.scanned} messages, found ${cards.size} to review."
        )
    }

    private fun toCard(t: ParsedTransaction): ReviewCard {
        val suggested = MerchantRules.categorise(t.merchant)
        val match = _state.value.categories.firstOrNull {
            it.scope == "EXPENSE" && it.name.equals(suggested, ignoreCase = true)
        }
        return ReviewCard(
            txn = t,
            title = t.merchant ?: "${t.bank} payment",
            amount = t.amountRupees,
            categoryId = match?.id,
            categoryName = match?.name,
            spentOn = isoDate(t.occurredAtMillis),
            personId = myPersonId
        )
    }

    fun editCard(index: Int, title: String, amount: Double, categoryId: String?) {
        val list = _state.value.review.toMutableList()
        val card = list.getOrNull(index) ?: return
        list[index] = card.copy(
            title = title,
            amount = amount,
            categoryId = categoryId,
            categoryName = _state.value.categories.firstOrNull { it.id == categoryId }?.name
        )
        _state.value = _state.value.copy(review = list)
    }

    /** Yes. Writes it to the family ledger, encrypted. */
    fun confirm(index: Int) = viewModelScope.launch {
        val card = _state.value.review.getOrNull(index) ?: return@launch
        val token = accessToken ?: return@launch
        val key = familyKey ?: return@launch
        val fid = familyId ?: return@launch
        val uid = userId ?: return@launch
        val person = card.personId ?: myPersonId
        if (person == null) {
            _state.value = _state.value.copy(error = "Could not tell who this belongs to. Open the web app once to finish setting up your name.")
            return@launch
        }
        _state.value = _state.value.copy(busy = true)
        val r = repo.addExpense(token, key, fid, uid, card.title, card.amount, card.spentOn, person, card.categoryId, null)
        r.fold(
            onSuccess = {
                // Teach the categoriser, so the same merchant is recognised next time.
                if (card.categoryName != null && card.txn.merchant != null) {
                    MerchantRules.learn(card.txn.merchant, card.categoryName)
                }
                seen.markSeen(listOf(card.txn.fingerprint))
                dismissLocally(index)
                _state.value = _state.value.copy(busy = false, notice = "Added ${card.title}.")
                refresh()
            },
            onFailure = { e -> _state.value = _state.value.copy(busy = false, error = e.message) }
        )
    }

    /** No. Never ask about this message again, but nothing is written. */
    fun dismiss(index: Int) = viewModelScope.launch {
        val card = _state.value.review.getOrNull(index) ?: return@launch
        seen.markSeen(listOf(card.txn.fingerprint))
        dismissLocally(index)
    }

    private fun dismissLocally(index: Int) {
        val list = _state.value.review.toMutableList()
        if (index in list.indices) list.removeAt(index)
        _state.value = _state.value.copy(review = list)
    }

    fun refresh() = viewModelScope.launch {
        val token = accessToken ?: return@launch
        val key = familyKey ?: return@launch
        val expenses = repo.loadExpenses(token, key)
        val categories = repo.loadCategories(token, key)
        val people = repo.loadPeople(token, key)
        myPersonId = people.firstOrNull { it.linkedUserId == userId }?.id
        _state.value = _state.value.copy(expenses = expenses, categories = categories, people = people)
    }

    fun signOut() = viewModelScope.launch {
        auth.signOut()
        accessToken = null; familyKey = null; familyId = null
        _state.value = UiState(stage = Stage.SIGNED_OUT)
    }

    fun clearMessages() {
        _state.value = _state.value.copy(error = null, notice = null)
    }

    private fun isoDate(millis: Long): String =
        DateTimeFormatter.ISO_LOCAL_DATE.format(Instant.ofEpochMilli(millis).atZone(ZoneId.systemDefault()))
}
