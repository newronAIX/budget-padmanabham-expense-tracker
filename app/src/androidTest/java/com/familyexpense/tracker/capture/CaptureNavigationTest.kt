package com.familyexpense.tracker.capture

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertContentDescriptionEquals
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import com.familyexpense.tracker.backend.Category
import com.familyexpense.tracker.backend.Expense
import com.familyexpense.tracker.sms.Direction
import com.familyexpense.tracker.sms.Instrument
import com.familyexpense.tracker.sms.ParsedTransaction
import com.familyexpense.tracker.sms.SenderKind
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * The signed-in shell has to be escapable: before the bottom bar existed, a user
 * who landed on the review queue had no way back to the ledger.
 *
 * These drive [CaptureScaffold] with a fabricated state, so no Supabase session,
 * family password or device SMS is involved.
 */
class CaptureNavigationTest {

    @get:Rule val compose = createComposeRule()

    private fun card(title: String, amount: Double) = ReviewCard(
        txn = ParsedTransaction(
            direction = Direction.DEBIT,
            amountPaise = (amount * 100).toLong(),
            merchant = title,
            accountMask = "1234",
            reference = null,
            occurredAtMillis = 1_700_000_000_000L,
            instrument = Instrument.UPI,
            bank = "HDFC",
            senderKind = SenderKind.BANK,
            mayDuplicate = false,
            fingerprint = "fp-$title",
            matchedBy = "test"
        ),
        title = title,
        amount = amount,
        categoryId = null,
        categoryName = null,
        spentOn = "2026-09-27",
        personId = null
    )

    private fun readyState(
        tab: Tab = Tab.HOME,
        review: List<ReviewCard> = emptyList()
    ) = UiState(
        stage = Stage.READY,
        tab = tab,
        review = review,
        expenses = listOf(Expense("e1", "Petrol", 500.0, "2026-09-26", "p1", "c1", null)),
        categories = listOf(Category("c1", "Travel", "EXPENSE", "#000000"))
    )

    @Test fun bottomBarSwitchesFromHomeToReview() {
        var tab = Tab.HOME
        compose.setContent {
            CaptureScaffold(
                state = readyState(tab = tab, review = listOf(card("Swiggy", 240.0))),
                actions = CaptureActions(selectTab = { tab = it })
            )
        }

        compose.onNodeWithText("Recent expenses").assertIsDisplayed()
        compose.onNodeWithText("To review").performClick()
        assertEquals(Tab.REVIEW, tab)
    }

    /**
     * The badge digits live under Material3's clearAndSetSemantics wrapper on the
     * icon, so they are pixels only -- a screen reader never sees them. The count
     * has to be announced on the item itself.
     */
    @Test fun reviewTabAnnouncesTheQueueCountToScreenReaders() {
        compose.setContent {
            CaptureScaffold(
                state = readyState(review = listOf(card("Swiggy", 240.0), card("Zomato", 310.0))),
                actions = CaptureActions()
            )
        }
        compose.onNodeWithText("To review")
            .assert(SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, "2 waiting"))
    }

    /** ...and the badge is still drawn, on screen, where a sighted user sees it. */
    @Test fun reviewTabDrawsTheBadge() {
        compose.setContent {
            CaptureScaffold(
                state = readyState(review = listOf(card("Swiggy", 240.0), card("Zomato", 310.0))),
                actions = CaptureActions()
            )
        }
        val badge = compose.onNodeWithText("2", useUnmergedTree = true).fetchSemanticsNode()
        assertTrue("badge has no size", badge.size.width > 0 && badge.size.height > 0)
        assertTrue("badge is off screen", badge.boundsInRoot.top >= 0f)
    }

    @Test fun anEmptyQueueShowsNoCount() {
        compose.setContent {
            CaptureScaffold(state = readyState(), actions = CaptureActions())
        }
        compose.onNodeWithText("To review")
            .assert(SemanticsMatcher.keyIsDefined(SemanticsProperties.StateDescription).not())
    }

    @Test fun emptyReviewQueueOffersAWayBack() {
        compose.setContent {
            CaptureScaffold(
                state = readyState(tab = Tab.REVIEW)
                    .copy(lastScanSummary = "Checked 40 messages. Nothing new."),
                actions = CaptureActions()
            )
        }
        compose.onNodeWithText("Checked 40 messages. Nothing new.").assertIsDisplayed()
        compose.onNodeWithText("Back to expenses").assertIsDisplayed()
    }

    @Test fun backToExpensesReturnsHome() {
        var tab = Tab.REVIEW
        compose.setContent {
            CaptureScaffold(
                state = readyState(tab = tab),
                actions = CaptureActions(selectTab = { tab = it })
            )
        }
        compose.onNodeWithText("Back to expenses").performClick()
        assertEquals(Tab.HOME, tab)
    }

    @Test fun lockedScreenHasNoBottomBar() {
        compose.setContent {
            CaptureScaffold(state = UiState(stage = Stage.LOCKED), actions = CaptureActions())
        }
        compose.onNodeWithText("Enter your family password").assertIsDisplayed()
        compose.onNodeWithText("Home").assertDoesNotExist()
    }
}
