package com.familyexpense.tracker.sms

import android.Manifest
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.rule.GrantPermissionRule
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Runs against the REAL SMS content provider on a device.
 *
 * The unit tests prove the parser understands a string. This proves the app can
 * actually get that string out of Android -- the column names, the Inbox URI,
 * the permission, and the sender filter. Those are exactly the parts a JVM test
 * cannot reach, and where a wrong constant fails silently rather than loudly.
 *
 * Seed the inbox first (see tools/seed_emulator_sms.sh).
 */
@RunWith(AndroidJUnit4::class)
class SmsInboxInstrumentedTest {

    @get:Rule
    val permission: GrantPermissionRule = GrantPermissionRule.grant(Manifest.permission.READ_SMS)

    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext

    private fun scan() = SmsInbox(context).scan(since = 0L, alreadySeen = emptySet())

    @Test fun readsTheInboxAtAll() {
        val result = scan()
        assertTrue("no messages were read -- seed the inbox first", result.scanned > 0)
    }

    @Test fun findsTheBankDebit() {
        val txns = scan().transactions
        val swiggy = txns.firstOrNull { it.merchant?.contains("Swiggy", true) == true }
        assertNotNull("SBI UPI debit was not recognised", swiggy)
        assertEquals(150.0, swiggy!!.amountRupees, 0.001)
        assertEquals(Direction.DEBIT, swiggy.direction)
    }

    /** An OTP carries an amount and a merchant; booking it invents an expense. */
    @Test fun doesNotBookTheOtp() {
        val txns = scan().transactions
        assertNull(txns.firstOrNull { it.amountRupees == 2499.0 })
    }

    @Test fun doesNotBookTheDeclinedTransaction() {
        val txns = scan().transactions
        assertNull(txns.firstOrNull { it.amountRupees == 1793.0 })
    }

    /** A human's message must be rejected on the sender, before its body is read. */
    @Test fun ignoresPersonalMessages() {
        val skipped = scan().skipped
        assertTrue("a personal message should be skipped as not_a_bank",
            (skipped["not_a_bank"] ?: 0) >= 1)
    }

    /** The wallet spend and the bank settling it are one payment. */
    @Test fun collapsesTheWalletAndBankPairIntoOne() {
        val debits = scan().transactions.filter { it.direction == Direction.DEBIT }
        val groups = DuplicateDetector.group(debits)
        val dream11 = groups.filter { g ->
            g.primary.amountPaise == 25100L || g.duplicates.any { it.amountPaise == 25100L }
        }
        assertEquals("the Rs 251 pair should form exactly one group", 1, dream11.size)
        assertTrue("it should be flagged as a repeat", dream11[0].duplicates.isNotEmpty())
    }

    /** The fingerprint is what stops an alert being offered twice. */
    @Test fun alreadySeenMessagesAreNotOfferedAgain() {
        val first = scan().transactions
        assertTrue(first.isNotEmpty())
        val seen = first.map { it.fingerprint }.toSet()
        val second = SmsInbox(context).scan(since = 0L, alreadySeen = seen)
        assertTrue("everything already reviewed should be skipped", second.transactions.isEmpty())
    }
}
