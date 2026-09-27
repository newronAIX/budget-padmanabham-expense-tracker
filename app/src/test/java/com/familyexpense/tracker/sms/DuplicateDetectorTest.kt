package com.familyexpense.tracker.sms

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class DuplicateDetectorTest {

    private var n = 0
    private fun txn(
        rupees: Double,
        atMillis: Long,
        bank: String = "HDFC Bank",
        kind: SenderKind = SenderKind.BANK,
        reference: String? = null
    ) = ParsedTransaction(
        direction = Direction.DEBIT,
        amountPaise = (rupees * 100).toLong(),
        merchant = "Shop",
        accountMask = "XX1234",
        reference = reference,
        occurredAtMillis = atMillis,
        instrument = Instrument.UPI,
        bank = bank,
        senderKind = kind,
        mayDuplicate = kind != SenderKind.BANK,
        fingerprint = "fp${n++}",
        matchedBy = "test"
    )

    private val t0 = 1_700_000_000_000L

    /** Under a minute: the same payment, collapsed without asking. */
    @Test fun sameAmountWithinAMinuteIsALikelyDuplicate() {
        val groups = DuplicateDetector.group(listOf(
            txn(250.0, t0, "PhonePe", SenderKind.WALLET),
            txn(250.0, t0 + 30_000, "HDFC Bank", SenderKind.BANK)
        ))
        assertEquals(1, groups.size)
        assertEquals(DuplicateDetector.Verdict.LIKELY, groups[0].verdict)
        // The bank is authoritative, so it is the one kept.
        assertEquals("HDFC Bank", groups[0].primary.bank)
        assertEquals(1, groups[0].duplicates.size)
    }

    /** One to five minutes: plausible either way, so ask rather than decide. */
    @Test fun sameAmountWithinFiveMinutesIsOnlyPossible() {
        val groups = DuplicateDetector.group(listOf(
            txn(250.0, t0, "PhonePe", SenderKind.WALLET),
            txn(250.0, t0 + 3 * 60_000, "HDFC Bank", SenderKind.BANK)
        ))
        assertEquals(1, groups.size)
        assertEquals(DuplicateDetector.Verdict.POSSIBLE, groups[0].verdict)
        assertTrue(groups[0].reason.contains("Same payment?"))
    }

    /** Beyond five minutes, two identical amounts are two real payments. */
    @Test fun sameAmountAfterFiveMinutesIsTwoPayments() {
        val groups = DuplicateDetector.group(listOf(
            txn(250.0, t0),
            txn(250.0, t0 + 6 * 60_000)
        ))
        assertEquals(2, groups.size)
        assertTrue(groups.all { it.verdict == DuplicateDetector.Verdict.UNIQUE })
    }

    /** Buying the same coffee twice in a day must not silently become one. */
    @Test fun identicalAmountsHoursApartAreKept() {
        val groups = DuplicateDetector.group(listOf(
            txn(120.0, t0),
            txn(120.0, t0 + 4 * 60 * 60_000)
        ))
        assertEquals(2, groups.size)
    }

    /** A shared UTR proves it, even when the two messages arrive far apart. */
    @Test fun sharedReferenceBeatsTheClock() {
        val groups = DuplicateDetector.group(listOf(
            txn(5000.0, t0, "HDFC Bank", reference = "431395842437"),
            txn(5000.0, t0 + 45 * 60_000, "HDFC Bank", reference = "431395842437")
        ))
        assertEquals(1, groups.size)
        assertEquals(DuplicateDetector.Verdict.LIKELY, groups[0].verdict)
        assertTrue(groups[0].reason.contains("same bank reference"))
    }

    @Test fun differentAmountsAreNeverGrouped() {
        val groups = DuplicateDetector.group(listOf(
            txn(250.0, t0, "PhonePe", SenderKind.WALLET),
            txn(251.0, t0 + 10_000, "HDFC Bank")
        ))
        assertEquals(2, groups.size)
    }

    /** A debit and a credit of the same size are a refund, not a duplicate. */
    @Test fun oppositeDirectionsAreNotDuplicates() {
        val debit = txn(250.0, t0)
        val credit = debit.copy(direction = Direction.CREDIT, fingerprint = "other")
        assertEquals(2, DuplicateDetector.group(listOf(debit, credit)).size)
    }

    /** HDFC RTGS genuinely sends two messages for one transfer. */
    @Test fun sameBankSendingTwiceIsCaught() {
        val groups = DuplicateDetector.group(listOf(
            txn(20000.0, t0, "HDFC Bank"),
            txn(20000.0, t0 + 20_000, "HDFC Bank")
        ))
        assertEquals(1, groups.size)
        assertTrue(groups[0].reason.contains("two messages"))
    }

    /** Three legs of one payment collapse to a single entry. */
    @Test fun threeWayCollapseKeepsTheBank() {
        val groups = DuplicateDetector.group(listOf(
            txn(180.9, t0, "Simpl", SenderKind.BNPL),
            txn(180.9, t0 + 15_000, "PhonePe", SenderKind.WALLET),
            txn(180.9, t0 + 40_000, "SBI", SenderKind.BANK)
        ))
        assertEquals(1, groups.size)
        assertEquals("SBI", groups[0].primary.bank)
        assertEquals(2, groups[0].duplicates.size)
    }

    @Test fun boundariesAreInclusiveAsDocumented() {
        // Exactly 5 minutes still asks; a millisecond past it does not.
        val atFive = DuplicateDetector.group(listOf(txn(99.0, t0), txn(99.0, t0 + DuplicateDetector.ASK_WINDOW_MS)))
        assertEquals(1, atFive.size)
        val pastFive = DuplicateDetector.group(listOf(txn(99.0, t0), txn(99.0, t0 + DuplicateDetector.ASK_WINDOW_MS + 1)))
        assertEquals(2, pastFive.size)
    }
}
