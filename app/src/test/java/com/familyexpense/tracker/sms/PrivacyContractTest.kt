package com.familyexpense.tracker.sms

import com.familyexpense.tracker.backend.ExpensePayload
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The promise is: a bank SMS is read on the phone, the numbers are taken out of
 * it, and the text itself is dropped. Nothing leaves the device but an expense,
 * and that expense is encrypted before it goes.
 *
 * A promise like that cannot rest on everyone remembering it. It rests on the
 * body having nowhere to go: [ParsedTransaction] is the only thing the SMS layer
 * hands outwards, so if it has no field to hold the text, no later code can
 * upload the text -- there is nothing to upload.
 *
 * These tests fail the build the moment that stops being true. If one of them
 * fails because you added a field, do not "fix" it by adding the field here.
 */
class PrivacyContractTest {

    /** Compiler-generated members: Compose's stability marker and the serializer holder. */
    private fun declaredFieldsOf(c: Class<*>): Set<String> =
        c.declaredFields
            .filterNot { it.isSynthetic }
            .map { it.name }
            .filterNot { it == "\$stable" || it == "Companion" }
            .toSet()

    /** Field names allowed to cross out of the SMS layer. Adding to this list is a privacy decision. */
    private val allowedOnTransaction = setOf(
        "direction", "amountPaise", "merchant", "accountMask", "reference",
        "occurredAtMillis", "instrument", "bank", "senderKind", "mayDuplicate",
        "fingerprint", "matchedBy"
    )

    @Test fun parsedTransactionCannotCarryTheMessageBody() {
        val actual = declaredFieldsOf(ParsedTransaction::class.java)
        assertEquals(
            "ParsedTransaction gained or lost a field. Anything added here can be " +
                "uploaded, so it must be a deliberate privacy decision.",
            allowedOnTransaction, actual
        )
    }

    @Test fun scanResultCannotCarryTheMessageBody() {
        val actual = declaredFieldsOf(SmsInbox.ScanResult::class.java)
        assertEquals(setOf("transactions", "skipped", "scanned"), actual)
    }

    @Test fun theUploadedPayloadHasNoFieldForRawMessageText() {
        val actual = declaredFieldsOf(ExpensePayload::class.java)
        assertEquals(
            setOf("familyId", "title", "amount", "spentOn", "personId", "categoryId", "note", "enteredBy"),
            actual
        )
    }

    @Test fun theFingerprintRevealsNothingAboutTheMessage() {
        val sender = "AD-HDFCBK"
        val body = "Rs.2,499.00 debited from a/c XX4471 on 14-03-25 to SWIGGY via UPI 412873610255. Not you? Call 18002586161"
        val t = (SmsParser.parse(sender, body, 1_700_000_000_000L) as ParseOutcome.Parsed).transaction

        assertTrue("fingerprint should be a hex digest", t.fingerprint.matches(Regex("[0-9a-f]{32}")))

        // No word of the message survives into the fingerprint.
        for (word in body.split(Regex("[^A-Za-z0-9]+")).filter { it.length >= 4 }) {
            assertTrue(
                "fingerprint leaks '$word'",
                !t.fingerprint.contains(word, ignoreCase = true)
            )
        }
        assertTrue("fingerprint leaks the account", !t.fingerprint.contains("4471"))
    }

    @Test fun twoDifferentMessagesGetDifferentFingerprints() {
        val a = SmsParser.parse("AD-HDFCBK", "Rs.100.00 debited from a/c XX1111 to SHOP via UPI 1", 1L)
        val b = SmsParser.parse("AD-HDFCBK", "Rs.100.00 debited from a/c XX1111 to SHOP via UPI 2", 1L)
        val fa = (a as ParseOutcome.Parsed).transaction.fingerprint
        val fb = (b as ParseOutcome.Parsed).transaction.fingerprint
        assertTrue("distinct messages must not collide", fa != fb)
    }
}
