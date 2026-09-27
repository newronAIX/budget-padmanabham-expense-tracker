package com.familyexpense.tracker.sms

import kotlin.math.abs

/**
 * Finds the same payment reported twice.
 *
 * One rupee leaving an account can produce several messages. The research behind
 * the parser found three real shapes of this:
 *
 *   * A wallet or BNPL spend, then the bank's own debit when it settles.
 *   * HDFC RTGS, which sends two messages for one transfer: one carrying the
 *     account, a later one carrying the UTR.
 *   * A credit-card bill paid from the same bank: a debit SMS and a card-credit
 *     SMS for one movement.
 *
 * Verdicts, by how confident we can honestly be:
 *
 *   LIKELY    collapsed by default, with the duplicate shown underneath so the
 *             user can split it back apart if we got it wrong.
 *   POSSIBLE  both shown, tagged, and the user is asked.
 *   UNIQUE    left alone.
 */
object DuplicateDetector {

    /** Under this, two identical amounts are the same payment. */
    const val CERTAIN_WINDOW_MS = 60_000L
    /** Between the two, it is worth asking rather than deciding. */
    const val ASK_WINDOW_MS = 5 * 60_000L

    enum class Verdict { UNIQUE, LIKELY, POSSIBLE }

    data class Group(
        val primary: ParsedTransaction,
        val duplicates: List<ParsedTransaction>,
        val verdict: Verdict,
        /** Plain-language reason, shown to the user. */
        val reason: String
    )

    fun group(transactions: List<ParsedTransaction>): List<Group> {
        val remaining = transactions.sortedBy { it.occurredAtMillis }.toMutableList()
        val groups = mutableListOf<Group>()

        while (remaining.isNotEmpty()) {
            val seed = remaining.removeAt(0)
            val matches = mutableListOf<ParsedTransaction>()
            var best = Verdict.UNIQUE
            var reason = ""

            val iterator = remaining.iterator()
            while (iterator.hasNext()) {
                val other = iterator.next()
                val (verdict, why) = compare(seed, other)
                if (verdict == Verdict.UNIQUE) continue
                matches += other
                iterator.remove()
                // Keep the strongest verdict found in the group.
                if (verdict == Verdict.LIKELY || best == Verdict.UNIQUE) {
                    best = verdict; reason = why
                }
            }

            if (matches.isEmpty()) {
                groups += Group(seed, emptyList(), Verdict.UNIQUE, "")
            } else {
                // The bank is authoritative about money leaving an account, so
                // it becomes the entry that gets kept; a wallet or BNPL message
                // describes the same rupee from one step removed.
                val all = (listOf(seed) + matches)
                val primary = all.firstOrNull { it.senderKind == SenderKind.BANK } ?: seed
                groups += Group(primary, all - primary, best, reason)
            }
        }
        return groups.sortedByDescending { it.primary.occurredAtMillis }
    }

    private fun compare(a: ParsedTransaction, b: ParsedTransaction): Pair<Verdict, String> {
        // A shared bank reference is proof, whatever the clock says. Two messages
        // quoting one UTR/RRN are two accounts of a single transfer.
        val refA = a.reference?.takeIf { it.length >= 8 }
        val refB = b.reference?.takeIf { it.length >= 8 }
        if (refA != null && refA == refB) {
            return Verdict.LIKELY to "Both messages quote the same bank reference."
        }

        if (a.amountPaise != b.amountPaise) return Verdict.UNIQUE to ""
        if (a.direction != b.direction) return Verdict.UNIQUE to ""

        val gap = abs(a.occurredAtMillis - b.occurredAtMillis)
        val sameSender = a.bank.equals(b.bank, ignoreCase = true)
        val amount = a.amountRupees

        return when {
            gap < CERTAIN_WINDOW_MS ->
                Verdict.LIKELY to if (sameSender) {
                    "${a.bank} sent two messages for the same ₹${fmt(amount)} within a minute."
                } else {
                    "${a.bank} and ${b.bank} both reported ₹${fmt(amount)} within a minute."
                }

            gap <= ASK_WINDOW_MS ->
                Verdict.POSSIBLE to
                    "${a.bank} and ${b.bank} both reported ₹${fmt(amount)}, ${gap / 60_000} minute(s) apart. Same payment?"

            else -> Verdict.UNIQUE to ""
        }
    }

    private fun fmt(v: Double): String =
        if (v % 1.0 == 0.0) v.toLong().toString() else String.format("%.2f", v)
}
