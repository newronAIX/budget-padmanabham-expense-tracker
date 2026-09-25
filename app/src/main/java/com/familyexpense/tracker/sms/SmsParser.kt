package com.familyexpense.tracker.sms

import java.security.MessageDigest
import java.text.Normalizer

/**
 * Turns a bank SMS into a transaction, or into a reason it is not one.
 *
 * THE CENTRAL RULE: direction comes from WHICH TEMPLATE MATCHED, never from
 * scanning the body for "debited" or "credited". Three real messages break a
 * keyword scan:
 *
 *   "Spent Rs.39791.72 From HDFC Bank Card x2227 At PZCREDIT9772829"
 *        -- the MERCHANT NAME contains "CREDIT"; a keyword scan books a
 *           Rs 39,791 spend as income.
 *   "ICICI Bank Acct XX000 debited for Rs 14.00 ...; Pune Metro credited."
 *        -- a debit that names the counterparty as credited.
 *   "Your a/c XX1234 is debited for Rs 1000 ... and a/c XX456 credited"
 *        -- same trap at PNB.
 *
 * Templates are ordered most-specific first and the first match wins.
 */
object SmsParser {

    // Currency is OPTIONAL. SBI's UPI debit -- the highest-volume debit SMS in
    // India -- has no currency token at all: "debited by 150.0". Requiring Rs/INR
    // silently loses every one of them.
    //
    // [.:] after the currency because Union Bank writes "Rs:151.00" and IDFC
    // writes "INR.1,234.00".
    //
    // The comma group is {2,3} so it accepts both lakh grouping (1,23,456.78) and
    // Western grouping (211,476.24); banks mix the two, sometimes in one message.
    //
    // The integer part may be missing entirely: real bodies contain "Rs..6" and
    // "USD .28".
    private const val AMT = """(?:(?:INR|Rs|₹)\s*[.:]?\s*)?(\d+(?:,\d{2,3})*(?:\.\d{1,2})?|\.\d{1,2})"""

    private fun re(p: String) = Regex(p, setOf(RegexOption.IGNORE_CASE, RegexOption.DOT_MATCHES_ALL))

    private data class Template(
        val name: String,
        val direction: Direction,
        val instrument: Instrument,
        val pattern: Regex,
        /** Named group holding the counterparty, if the template captures one. */
        val merchantGroup: String? = "merchant"
    )

    // Ordered: most specific first.
    private val TEMPLATES: List<Template> = listOf(

        // ---- UPI debits -------------------------------------------------------
        // SBI: no currency, single decimal, "trf to", "Refno" as one word.
        Template("sbi_upi_debit", Direction.DEBIT, Instrument.UPI,
            re("""\bA/?C\s*[Xx*]+\d+\s+debited\s+by\s+$AMT\b.{0,40}?\btrf\s+to\s+(?<merchant>.+?)\s+Ref\s?no""")),

        // HDFC line-delimited: "Sent Rs.100\nFrom HDFC Bank A/C *0000\nTo NAME"
        Template("hdfc_sent_multiline", Direction.DEBIT, Instrument.UPI,
            re("""\bSent\s+$AMT\s.{0,60}?\bTo\s+(?<merchant>[^\n]+?)\s*(?:\n|\bOn\b)""")),

        Template("kotak_sent", Direction.DEBIT, Instrument.UPI,
            re("""\bSent\s+$AMT\s+from\s+.{0,40}?\bto\s+(?<merchant>.+?)\s+on\s+\d""")),

        // Union Bank writes the payee after "Fvg:" (favouring).
        Template("union_debit", Direction.DEBIT, Instrument.NETBANKING,
            re("""\bDebited\s+$AMT\b.{0,80}?\bFvg:\s*(?<merchant>.+?)\s+Avl""")),

        // Bank of Baroda and Canara abbreviate the verb to "Dr." -- most parsers
        // miss this entirely because they only look for "debited".
        Template("bob_dr", Direction.DEBIT, Instrument.UPI,
            re("""$AMT\s+Dr\.\s+from\s+A/C\s+\S+\s+and\s+Cr\.\s+to\s+(?<merchant>\S+)""")),

        Template("canara_dr", Direction.DEBIT, Instrument.UPI,
            re("""\bAcct\s+\S+\s+Dr\.\s+$AMT\s+on\s+\S+\s+to\s+(?<merchant>[^;]+);""")),

        // Axis: UPI/P2M/<ref>/<NAME>. P2M = merchant, P2A = person -- a free
        // merchant-vs-person classifier no other bank gives us.
        Template("axis_upi_debit", Direction.DEBIT, Instrument.UPI,
            re("""$AMT\s+debited\s+A/c\s+no\.\s+\S+\s.{0,40}?UPI/P2[MA]/\d+/(?<merchant>[^/\n]+)""")),

        Template("icici_upi_debit", Direction.DEBIT, Instrument.UPI,
            re("""\bAcct?\s+\S+\s+debited\s+for\s+$AMT\s+on\s+\S+;\s*(?<merchant>.+?)\s+credited""")),

        Template("idfc_upi_debit", Direction.DEBIT, Instrument.UPI,
            re("""\bA/c\s+\S+\s+debited\s+by\s+$AMT\s+on\s+\S+;\s*(?<merchant>.+?)\s+credited""")),

        Template("indusind_debit", Direction.DEBIT, Instrument.UPI,
            re("""\bA/C\s+\S+\s+debited\s+by\s+$AMT\s+towards\s+(?<merchant>\S+)""")),

        Template("federal_upi_debit", Direction.DEBIT, Instrument.UPI,
            re("""$AMT\s+debited\s+via\s+UPI\s+on\s+.{0,30}?\bto\s+VPA\s+(?<merchant>\S+?)\.?Ref""")),

        Template("generic_debited_to", Direction.DEBIT, Instrument.UPI,
            re("""\bdebited\b.{0,50}?$AMT\b.{0,60}?\bto\s+(?:VPA\s+)?(?<merchant>[A-Za-z0-9@._\- ]{2,40}?)\s*(?:\(|\.|,|\bon\b|\bUPI\b|$)""")),

        // ---- Card debits ------------------------------------------------------
        // HDFC: "From ... Card" is a debit card, "On ... Card" is a credit card.
        Template("hdfc_card_spent", Direction.DEBIT, Instrument.CARD,
            re("""\bSpent\s+$AMT\s+(?:From|On)\s+HDFC\s+Bank\s+Card\s+\S+\s+At\s+(?<merchant>.+?)\s+On\s+\d""")),

        Template("amount_spent_on_card_at", Direction.DEBIT, Instrument.CARD,
            re("""$AMT\s+spent\s+(?:on|using|via)\s+.{0,60}?\b(?:card|Card)\b.{0,30}?\s+(?:at|on)\s+(?<merchant>.+?)\s*(?:\s+on\s+\d|\.\s|,\s|$)""")),

        // Axis card: the merchant is a bare unlabelled line.
        Template("axis_card_spent", Direction.DEBIT, Instrument.CARD,
            re("""\bSpent\s+$AMT\s*\n.*?Card no\..*?\n.*?\n(?<merchant>[^\n]+)\n\s*Avl Limit""")),

        Template("sbi_card_spent", Direction.DEBIT, Instrument.CARD,
            re("""$AMT\s+spent\s+on\s+your\s+SBI\s+Credit\s+Card\s+ending\s+(?:with\s+)?\d+\s+at\s+(?<merchant>.+?)\s+on\s+\d""")),

        Template("sbi_card_no_merchant", Direction.DEBIT, Instrument.CARD,
            re("""$AMT\s+spent\s+on\s+your\s+SBI\s+Credit\s+Card\s+ending\s+(?:with\s+)?\d+\s+on\s+\d"""), merchantGroup = null),

        Template("amex_spent", Direction.DEBIT, Instrument.CARD,
            re("""You've\s+spent\s+$AMT\s+on\s+your\s+AMEX.{0,30}?\s+at\s+(?<merchant>.+?)\s+on\s+\d""")),

        Template("rbl_card_spent", Direction.DEBIT, Instrument.CARD,
            re("""$AMT\s+spent\s+at\s+(?<merchant>.+?)\s+on\s+RBL\s+Bank\s+credit\s+card""")),

        Template("sbi_debit_card", Direction.DEBIT, Instrument.CARD,
            re("""transaction number\s+\d+\s+for\s+$AMT\s+by\s+SBI\s+Debit\s+Card\s+\S+\s+done\s+at\s+(?<merchant>.+?)\s+on\s+\d""")),

        Template("kotak_card_spent", Direction.DEBIT, Instrument.CARD,
            re("""$AMT\s+spent\s+via\s+Kotak\s+Debit\s+Card\s+\S+\s+at\s+(?<merchant>.+?)\s+on\s+\d""")),

        Template("idfc_card_spent", Direction.DEBIT, Instrument.CARD,
            re("""\bSpent\s+$AMT\s+from\s+A/C\s+\S+\s+at\s+(?<merchant>.+?)\s+on\s+\d""")),

        // ---- ATM --------------------------------------------------------------
        // Federal glues the location to the verb: "withdrawn@ YBL CHAN".
        Template("atm_withdrawal", Direction.DEBIT, Instrument.ATM,
            re("""$AMT\s+withdrawn\s*@?\s*(?<merchant>.+?)\s+on\s+\d""")),

        // ---- Other debits -----------------------------------------------------
        Template("hdfc_imps_sent", Direction.DEBIT, Instrument.NETBANKING,
            re("""\bIMPS\s+$AMT\s+sent\s+from\b""", ), merchantGroup = null),

        Template("federal_neft_debit", Direction.DEBIT, Instrument.NETBANKING,
            re("""\bDebited\s+$AMT\s+from\s+a/c\s+\S+\s+on\s+.{0,30}?\bto\s+(?<merchant>.+?)\.Ref""")),

        Template("pnb_debited_with", Direction.DEBIT, Instrument.NETBANKING,
            re("""\bAc\s+\S+\s+Debited\s+with\s+$AMT""", ), merchantGroup = null),

        Template("mandate_debit", Direction.DEBIT, Instrument.MANDATE,
            re("""payment of\s+$AMT\s+for\s+(?<merchant>.+?)\s+via\s+e-?mandate.{0,80}?\bprocessed successfully""")),

        Template("bbps_autodebit", Direction.DEBIT, Instrument.MANDATE,
            re("""successfully debited your .{0,60}?bill for the amount\s+$AMT""", ), merchantGroup = null),

        Template("generic_deducted", Direction.DEBIT, Instrument.NETBANKING,
            re("""\bAmt Deducted!\s*$AMT\s+from\b""", ), merchantGroup = null),

        // ---- Credits ----------------------------------------------------------
        Template("hdfc_credit_alert", Direction.CREDIT, Instrument.UPI,
            re("""$AMT\s+credited\s+to\s+HDFC\s+Bank\s+A/c\s+\S+\s+on\s+\S+\s+from\s+VPA\s+(?<merchant>\S+)""")),

        Template("sbi_credit", Direction.CREDIT, Instrument.NETBANKING,
            re("""\bA/c\s*\S*-?credited\s+by\s+$AMT\s+on\s+\S+\s+transfer\s+from\s+(?<merchant>.+?)\s+Ref""")),

        Template("axis_upi_credit", Direction.CREDIT, Instrument.UPI,
            re("""$AMT\s+credited\s+A/c\s+no\.\s+\S+\s.{0,40}?UPI/P2[MA]/\d+/(?<merchant>[^/\n]+)""")),

        Template("kotak_received", Direction.CREDIT, Instrument.UPI,
            re("""\bReceived\s+$AMT\s+in\s+your\s+Kotak\s+Bank\s+AC\s+\S+\s+from\s+(?<merchant>.+?)\s+on\s+\d""")),

        Template("canara_credit", Direction.CREDIT, Instrument.UPI,
            re("""\bAcct\s+\S+\s+credited\s+with\s+$AMT\s+on\s+\S+\s+from\s+(?<merchant>[^;]+);""")),

        Template("refund_credit", Direction.CREDIT, Instrument.CARD,
            re("""$AMT\s+refunded\s+by\s+(?<merchant>.+?)\s+on\s+\d""")),

        Template("reversal_credit", Direction.CREDIT, Instrument.CARD,
            re("""(?:Transaction Reversed!|Txn reversal of)\s*.{0,60}?$AMT""", ), merchantGroup = null),

        Template("reversed_credited_back", Direction.CREDIT, Instrument.NETBANKING,
            re("""$AMT\s+reversed\s+and\s+credited\s+back"""), merchantGroup = null),

        Template("generic_credited", Direction.CREDIT, Instrument.NETBANKING,
            re("""(?:$AMT\s+(?:is\s+)?(?:credited|deposited|received)|(?:credited|deposited|received)\s+(?:with|by|to your A/c)?\s*$AMT)"""), merchantGroup = null)
    )

    private val REF = Regex("""(?:Ref(?:erence)?\s*(?:No\.?|#|:|-)?\s*|RRN[:\s]*|UPI[:\s]+)([A-Z0-9]{6,})""", RegexOption.IGNORE_CASE)
    private val MASK = Regex("""(?:A/?[Cc]|Acct?|Card)\s*(?:no\.?\s*)?[:\s]*([Xx*]+\s?\d{3,6}|\d{4})""")

    /**
     * @param sender the SMS originating address
     * @param body   the message text -- used here and then dropped, never stored
     * @param receivedAtMillis fallback timestamp; several banks omit the date
     *        entirely (IndusInd, and HDFC's "Amt Deducted!")
     */
    fun parse(sender: String?, body: String, receivedAtMillis: Long): ParseOutcome {
        val bank = SmsSenders.bankFor(sender)
            ?: return ParseOutcome.NotATransaction("unknown_sender")

        // SBI Card sends some alerts with Unicode Math Sans-Serif substituted for
        // ASCII letters. Without NFKC they fail every regex silently.
        val text = Normalizer.normalize(body, Normalizer.Form.NFKC)

        SmsExclusions.exclusionFor(text)?.let { return ParseOutcome.Excluded(it) }

        for (t in TEMPLATES) {
            val m = t.pattern.find(text) ?: continue
            val paise = parseAmountToPaise(m.groupValues[1]) ?: continue
            if (paise <= 0L) continue

            val merchant = t.merchantGroup
                ?.let { g -> runCatching { m.groups[g]?.value }.getOrNull() }
                ?.let(MerchantRules::clean)

            return ParseOutcome.Parsed(
                ParsedTransaction(
                    direction = t.direction,
                    amountPaise = paise,
                    merchant = merchant,
                    accountMask = MASK.find(text)?.groupValues?.get(1)?.replace(" ", ""),
                    reference = REF.find(text)?.groupValues?.get(1),
                    occurredAtMillis = receivedAtMillis,
                    instrument = t.instrument,
                    bank = bank,
                    fingerprint = fingerprint(sender, body, receivedAtMillis),
                    matchedBy = t.name
                )
            )
        }
        return ParseOutcome.NeedsReview("no_template_matched")
    }

    /** Money in paise, so no floating point ever touches an amount. */
    internal fun parseAmountToPaise(raw: String): Long? {
        val cleaned = raw.replace(",", "").trim()
        if (cleaned.isEmpty() || cleaned == ".") return null
        val parts = cleaned.split(".")
        return runCatching {
            val rupees = parts[0].ifEmpty { "0" }.toLong()
            // One decimal place is common ("150.0", "99999.9"), so pad rather
            // than assuming two.
            val paise = parts.getOrNull(1)?.padEnd(2, '0')?.take(2)?.toLong() ?: 0L
            rupees * 100 + paise
        }.getOrNull()
    }

    /**
     * One-way. Lets the app skip messages already reviewed without keeping any
     * record of what they said.
     */
    private fun fingerprint(sender: String?, body: String, at: Long): String {
        val digest = MessageDigest.getInstance("SHA-256")
            .digest("${sender ?: ""}|$at|$body".toByteArray(Charsets.UTF_8))
        return digest.joinToString("") { "%02x".format(it) }.take(32)
    }
}
