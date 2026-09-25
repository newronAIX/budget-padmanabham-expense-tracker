package com.familyexpense.tracker.sms

/**
 * What the SMS layer is allowed to hand onwards.
 *
 * PRIVACY CONTRACT: the message body is deliberately NOT a field here. Bodies are
 * read from the inbox, parsed in memory, and dropped. Nothing downstream can
 * persist or transmit the original text because nothing downstream ever sees it.
 *
 * [fingerprint] exists so an already-reviewed message is not shown twice. It is a
 * one-way hash, so the local "seen" list reveals nothing about the messages.
 */
data class ParsedTransaction(
    val direction: Direction,
    val amountPaise: Long,
    val merchant: String?,
    val accountMask: String?,
    val reference: String?,
    val occurredAtMillis: Long,
    val instrument: Instrument,
    val bank: String,
    val senderKind: SenderKind,
    /**
     * True when the same rupee is very likely to arrive again from another
     * sender. A BNPL purchase is followed days later by the bank settlement and
     * the provider's own receipt -- three messages, one expense. The review card
     * says so rather than the app silently double counting.
     */
    val mayDuplicate: Boolean,
    val fingerprint: String,
    /** Which template matched. Kept for debugging and for tuning, never displayed. */
    val matchedBy: String
) {
    val amountRupees: Double get() = amountPaise / 100.0
}

enum class Direction { DEBIT, CREDIT }

enum class Instrument { UPI, CARD, NETBANKING, ATM, MANDATE, UNKNOWN }

/** Why a message produced nothing, so the reasons can be counted while tuning. */
sealed interface ParseOutcome {
    data class Parsed(val transaction: ParsedTransaction) : ParseOutcome
    data class Excluded(val rule: String) : ParseOutcome
    data class NotATransaction(val reason: String) : ParseOutcome
    /** Looks financial but no template matched — surfaced for manual entry, never guessed at. */
    data class NeedsReview(val reason: String) : ParseOutcome
}
