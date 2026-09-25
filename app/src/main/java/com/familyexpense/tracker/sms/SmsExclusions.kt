package com.familyexpense.tracker.sms

/**
 * Messages that carry an amount but did not move money.
 *
 * This gate runs BEFORE extraction. Getting it wrong in either direction is
 * costly: too loose and an OTP becomes a phantom expense, too tight and real
 * spends vanish.
 *
 * Two traps worth stating, because both are counter-intuitive:
 *
 *  1. Never exclude on the bare words "EMI" or "minimum due". A real ICICI card
 *     spend alert contains "EMI" twice (it advertises EMI conversion), and a real
 *     refund alert contains "minimum due". Excluding on those drops genuine rows.
 *
 *  2. "failed" does not always mean nothing happened. A reversal credit reads
 *     "reversed and credited back ... for failed UPI txn" -- money really did
 *     arrive. So a failure word only excludes when no completed credit verb is
 *     present alongside it.
 */
object SmsExclusions {

    private fun re(p: String) = Regex(p, setOf(RegexOption.IGNORE_CASE, RegexOption.DOT_MATCHES_ALL))

    /** rule name -> pattern. Name is kept so misfires can be traced to a rule. */
    private val RULES: List<Pair<String, Regex>> = listOf(
        "otp" to re("""\b(otp|one[-\s]?time\s?password|verification code|do not share)\b"""),
        // A future-dated auto-debit notice. RBI mandates these 24h ahead, so they
        // are high volume, and the real debit arrives later as its own message.
        "future_debit" to re("""\bwill be (auto[-\s]?)?(debited|deducted|charged)\b"""),
        "mandate_notice" to re("""\bUMN\b|\be-?mandate!"""),
        "payment_request" to re("""\b(has requested|payment request|collect request|requesting payment|requests rs)\b"""),
        "promotional" to re("""\b(cashback offer|discount|congratulations|you can win|apply now|pre-?approved|click here to avail)\b"""),
        "due_reminder" to re("""\b(is due|min(imum)? amount due|in arrears|is overdue|pls pay|please pay by|total due:)\b"""),
        "statement" to re("""\b(statement (for|of).{0,40}(is )?generated|bill of .{0,20}is ready|bill is generated)\b"""),
        // IPO application money is lien-marked, not spent.
        "asba_lien" to re("""\b(asba|is blocked in your|is unblocked)\b"""),
        "balance_enquiry" to re("""^\s*(your )?(a/?c|acct?)\b.{0,40}\b(available )?bal(ance)?\s*(is|:)""" ),
        "cheque_info" to re("""\bcheque no\.?\s*\d+.{0,60}\b(cleared|presented|returned|bounced)\b"""),
        "limit_change" to re("""\b(limit has been (updated|changed|set)|txn limit)\b"""),
        "login_alert" to re("""\b(login|log-?in|mpin|password).{0,30}\b(failed|attempt|changed|reset)\b"""),
        "future_refund" to re("""\bwill be credited\b"""),
        "merchant_ack" to re("""\bhave received payment\b""")
    )

    private val FAILED = re("""\b(failed|declined|unsuccessful|not successful|was not completed|could not be completed|rejected|cancelled|reversal failed)\b""")
    /** A completed inbound movement. Presence of this rescues a "failed" message. */
    private val COMPLETED_CREDIT = re("""\b(reversed and credited|credited back|has been credited|refunded|successfully credited)\b""")

    /** At least one of these must appear, or it is not a transaction at all. */
    private val MONEY_VERB = re("""\b(?:debited|credited|spent|withdrawn|withdrawal|deposited|received|sent|transferred|deducted|paid|purchase[sd]?|refunded|reversed|charged|settled)\b|\b(?:dr|cr)\.""")

    /**
     * @return the name of the rule that excluded it, or null to continue parsing.
     */
    fun exclusionFor(body: String): String? {
        for ((name, pattern) in RULES) {
            if (pattern.containsMatchIn(body)) return name
        }
        if (FAILED.containsMatchIn(body) && !COMPLETED_CREDIT.containsMatchIn(body)) return "failed_txn"
        if (!MONEY_VERB.containsMatchIn(body)) return "no_money_verb"
        return null
    }
}
