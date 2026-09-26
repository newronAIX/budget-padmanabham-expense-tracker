package com.familyexpense.tracker.sms

import android.content.Context
import android.database.Cursor
import android.net.Uri
import android.provider.Telephony

/**
 * Reads the SMS inbox, parses it, and returns transactions.
 *
 * PRIVACY CONTRACT, enforced by construction rather than by discipline:
 *
 *   * Message bodies are read into a local variable, parsed, and dropped. They
 *     are never stored, never logged, never sent anywhere. ParsedTransaction has
 *     no field that could carry one.
 *   * The only thing persisted is a SHA-256 fingerprint of each message already
 *     reviewed, so the same one is not shown twice. A hash cannot be read back,
 *     so the "seen" list discloses nothing even if the device is compromised.
 *   * Only senders in the bank registry are read at all. Personal messages are
 *     skipped before their body is even examined.
 *
 * The app never becomes the default SMS handler and never writes or sends SMS.
 */
class SmsInbox(private val context: Context) {

    data class ScanResult(
        val transactions: List<ParsedTransaction>,
        /** Counts by reason, for tuning. Carries no message content. */
        val skipped: Map<String, Int>,
        val scanned: Int
    )

    /**
     * @param since only look at messages newer than this (epoch millis)
     * @param alreadySeen fingerprints the user has already reviewed
     */
    fun scan(since: Long, alreadySeen: Set<String>): ScanResult {
        val found = mutableListOf<ParsedTransaction>()
        val skipped = mutableMapOf<String, Int>()
        var scanned = 0

        val projection = arrayOf(
            Telephony.Sms.ADDRESS,
            Telephony.Sms.BODY,
            Telephony.Sms.DATE
        )
        val cursor: Cursor = context.contentResolver.query(
            Telephony.Sms.Inbox.CONTENT_URI,
            projection,
            "${Telephony.Sms.DATE} > ?",
            arrayOf(since.toString()),
            "${Telephony.Sms.DATE} DESC"
        ) ?: return ScanResult(emptyList(), mapOf("cursor_unavailable" to 1), 0)

        cursor.use { c ->
            val addressIdx = c.getColumnIndexOrThrow(Telephony.Sms.ADDRESS)
            val bodyIdx = c.getColumnIndexOrThrow(Telephony.Sms.BODY)
            val dateIdx = c.getColumnIndexOrThrow(Telephony.Sms.DATE)

            while (c.moveToNext()) {
                scanned++
                val sender = c.getString(addressIdx)

                // Cheapest possible rejection, and the most important one for
                // privacy: a non-bank sender's body is never even read.
                if (SmsSenders.identify(sender) == null) {
                    skipped.merge("not_a_bank", 1, Int::plus)
                    continue
                }

                val body = c.getString(bodyIdx) ?: continue
                val date = c.getLong(dateIdx)

                when (val outcome = SmsParser.parse(sender, body, date)) {
                    is ParseOutcome.Parsed -> {
                        if (outcome.transaction.fingerprint in alreadySeen) {
                            skipped.merge("already_reviewed", 1, Int::plus)
                        } else {
                            found += outcome.transaction
                        }
                    }
                    is ParseOutcome.Excluded -> skipped.merge(outcome.rule, 1, Int::plus)
                    is ParseOutcome.NotATransaction -> skipped.merge(outcome.reason, 1, Int::plus)
                    is ParseOutcome.NeedsReview -> skipped.merge("unrecognised_format", 1, Int::plus)
                }
                // `body` goes out of scope here and is never retained.
            }
        }
        return ScanResult(found, skipped, scanned)
    }

    companion object {
        /** A sensible first scan: this month and the previous one. */
        fun defaultSince(nowMillis: Long): Long = nowMillis - 60L * 24 * 60 * 60 * 1000
    }
}
