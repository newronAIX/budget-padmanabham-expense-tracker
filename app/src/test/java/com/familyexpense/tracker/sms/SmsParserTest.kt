package com.familyexpense.tracker.sms

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Fixtures are verbatim message SHAPES from real-world corpora; digits and names
 * are scrubbed. Each one exists because it broke something.
 */
class SmsParserTest {

    private fun parsed(sender: String, body: String): ParsedTransaction {
        val r = SmsParser.parse(sender, body, 1_700_000_000_000L)
        assertTrue("expected a transaction, got $r", r is ParseOutcome.Parsed)
        return (r as ParseOutcome.Parsed).transaction
    }

    private fun assertDebit(sender: String, body: String, rupees: Double) {
        val t = parsed(sender, body)
        assertEquals(Direction.DEBIT, t.direction)
        assertEquals(rupees, t.amountRupees, 0.001)
    }

    private fun assertCredit(sender: String, body: String, rupees: Double) {
        val t = parsed(sender, body)
        assertEquals(Direction.CREDIT, t.direction)
        assertEquals(rupees, t.amountRupees, 0.001)
    }

    private fun assertRejected(sender: String, body: String) {
        val r = SmsParser.parse(sender, body, 1_700_000_000_000L)
        assertTrue("should NOT have parsed: $r", r !is ParseOutcome.Parsed)
    }

    // ---- the highest-volume debit SMS in India: no currency token at all ----
    @Test fun sbiUpiDebitWithoutCurrency() = assertDebit("VM-SBIUPI-S",
        "Dear UPI user A/C X1234 debited by 150.0 on date 05Mar24 trf to SWIGGY Refno 406512345678. If not u? call 1800111109. -SBI", 150.0)

    @Test fun hdfcSentMultiline() = assertDebit("VM-HDFCBK-S",
        "Sent Rs.100.00\nFrom HDFC Bank A/C *0000\nTo CUSTOMER NAME\nOn 17/05/26\nRef 000000000000", 100.0)

    /** Merchant name literally contains "CREDIT" -- a keyword scan books this as income. */
    @Test fun merchantContainingCreditIsStillADebit() {
        val t = parsed("VM-HDFCDC-S",
            "Spent Rs.3000 From HDFC Bank Card x0000 At PZCREDIT0000000 On 2026-05-02:00:17:56 Bal Rs.142.26")
        assertEquals(Direction.DEBIT, t.direction)
        assertEquals(3000.0, t.amountRupees, 0.001)
        assertEquals("PayZapp", t.merchant)
    }

    /** Debit that names the counterparty as "credited". */
    @Test fun counterpartyCreditedIsStillADebit() = assertDebit("JD-ICICIT-S",
        "ICICI Bank Acct XX000 debited for Rs 14.00 on 09-May-26; Pune Metro credited. UPI:000000000000.", 14.0)

    @Test fun axisP2M() = assertDebit("AD-AXISBK-S",
        "INR 726.00 debited A/c no. XX1234 05-09-26, 10:19:49 UPI/P2M/000000000000/RAHUL SHARMA Not you? Axis Bank", 726.0)

    /** Bank of Baroda abbreviates the verb to "Dr." rather than "debited". */
    @Test fun bankOfBarodaDrAbbreviation() = assertDebit("VM-BOBTXN-S",
        "Rs.230.00 Dr. from A/C XXXXXX1234 and Cr. to example@okbank. Ref:000000000000. AvlBal:Rs618.85", 230.0)

    /** Union Bank writes the amount with a colon: "Rs:151.00". */
    @Test fun unionBankColonCurrency() = assertDebit("VM-UNIONB-S",
        "Union Bank of India A/c *0000 Debited Rs:151.00 on 25-08-2026 09:50:01 by Mob Bk ref no 000000000000, Fvg: RAHUL SHARMA Avl Bal Rs:7138.46.", 151.0)

    @Test fun lakhGrouping() = assertDebit("VM-HDFCBK-S",
        "Rs.1,23,456.78 spent on HDFC Bank Card x0000 at BIG STORE on 2026-07-12:17:00:56.", 123456.78)

    /** Four-plus digits with NO comma grouping. This regressed once: "Rs.3000" parsed as 300. */
    @Test fun ungroupedFourDigitAmount() = assertDebit("VM-KBANKT-S",
        "Sent Rs.500.00 from Kotak Bank A/c X0000 to SampleCo on 10-09-26. UPI Ref 000000000000.", 500.0)

    /** A real ICICI card spend advertises EMI conversion twice -- must not be excluded. */
    @Test fun realSpendMentioningEmiIsNotExcluded() = assertDebit("JD-ICICIT-S",
        "Rs 100.00 spent on ICICI Bank Card XX0000 on 16-May-26 at SAMPLE MERCHANT. Avl Lmt: Rs 200.00. To convert this txn to EMI give a missed call. Know more about EMI conversion.", 100.0)

    @Test fun sbiCardWithoutMerchant() = assertDebit("VM-SBICRD-S",
        "Rs.259.00 spent on your SBI Credit Card ending with 1234 on 15Jan26. Your available limit is Rs.1,235.00.", 259.0)

    @Test fun amexSpelledOutDate() = assertDebit("VM-AMEXIN-S",
        "Alert: You've spent INR 4,411.00 on your AMEX Corp Card ** 21006 at CWT INDIA on 8 January 2026 at 11:29 PM IST.", 4411.0)

    @Test fun federalAtmWithdrawal() = assertDebit("VM-FEDBNK-S",
        "Rs 1500 withdrawn@ YBL CHAN on 21JAN26 17:59 Bal Rs 7517.94 Ref 602117126490.", 1500.0)

    // ---- credits ----
    @Test fun hdfcCreditAlert() = assertCredit("VM-HDFCBK-S",
        "Credit Alert!\nRs.1.00 credited to HDFC Bank A/c XX0000 on 09-05-26\nfrom VPA customer@bank (UPI 000000000000)", 1.0)

    @Test fun sbiCredit() = assertCredit("AD-SBIINB-S",
        "Dear SBI User, your A/c X0000-credited by Rs.12345 on 28Jul26 transfer from Sample Name Ref No 123456789012 -SBI", 12345.0)

    @Test fun refund() = assertCredit("JD-ICICIT-S",
        "Alert! Rs. 262.56 refunded by SampleMerchant Payments BANGALORE IND on 17/MAY/2026 & adjusted against HDFC Bank Credit Card 0000", 262.56)

    /** Contains "failed", but a reversal genuinely credited the account. */
    @Test fun reversalIsACreditDespiteTheWordFailed() = assertCredit("AD-SBIINB-S",
        "Rs 500.00 reversed and credited back to your A/c XX5678 on 23-09-26 for failed UPI txn Ref 626512349999. -SBI", 500.0)

    // ---- must be rejected ----
    /** Carries an amount AND a merchant. The nastiest false positive there is. */
    @Test fun otpIsNotATransaction() = assertRejected("VM-HDFCBK-S",
        "482913 is OTP for txn of INR 2,499.00 at AMAZON on HDFC Bank card ending 4411. Do not share OTP")

    @Test fun futureMandateIsNotATransaction() = assertRejected("VM-HDFCBK-S",
        "E-Mandate!\nRs.3821.00 will be deducted on 02/03/26\nFor Rentomojo mandate\nUMN 6cc417@ybl")

    @Test fun failedTransaction() = assertRejected("VM-CANBNK-S",
        "Dear Customer, txn of Rs.637.70 thru A/C XX1234 on 18-8-26 to ACME STORE failed due to INSUFFICIENT FUNDS-Canara Bank")

    @Test fun declinedTransaction() = assertRejected("VM-RBLBNK-S",
        "ALERT: Credit limit exceeded. Your transaction for INR 1,793.00 at ROLLA HYPER MARKET was declined")

    @Test fun statementGenerated() = assertRejected("VM-BOBCRD-S",
        "Hi, Your April-2026 bill of Rs.7,777.77 is ready. Please pay by 05 May, 2026 through the OneCard app.")

    @Test fun dueReminder() = assertRejected("VM-YESBNK-S",
        "Payment of Equitas Credit Card 0000 is due on 10/07/26. Min due Rs 1234.56 Total due Rs 12345.67.")

    @Test fun ipoLienIsNotSpending() = assertRejected("VM-IDFCFB-S",
        "Your ASBA application for SAMPLEIPO is received and Application value of Rs 14999 is blocked in your registered Bank account")

    @Test fun promisedFutureRefund() = assertRejected("JD-ICICIT-S",
        "Refund of Rs 1,299 for your order has been processed and will be credited to your ICICI Bank card in 3-5 days.")

    /** A bank alert from a bare mobile number is a scam imitating one. */
    @Test fun alertFromPhoneNumberIsRejected() = assertRejected("+919876543210",
        "Rs.5000.00 debited from your account. Call 9876543210 immediately if not you.")

    @Test fun unknownSenderIsRejected() = assertRejected("VM-SHOPPY-P",
        "Rs.500 spent at OUR STORE. Thanks for shopping!")

    // ---- amount parsing ----
    @Test fun amountUnits() {
        assertEquals(15000L, SmsParser.parseAmountToPaise("150.0"))
        assertEquals(12345678L, SmsParser.parseAmountToPaise("1,23,456.78"))
        assertEquals(21147624L, SmsParser.parseAmountToPaise("211,476.24"))
        assertEquals(300000L, SmsParser.parseAmountToPaise("3000"))
        assertEquals(28L, SmsParser.parseAmountToPaise(".28"))
    }

    @Test fun fingerprintIsStableAndRevealsNothing() {
        val a = parsed("VM-SBIUPI-S", "Dear UPI user A/C X1234 debited by 150.0 on date 05Mar24 trf to SWIGGY Refno 406512345678.")
        val b = parsed("VM-SBIUPI-S", "Dear UPI user A/C X1234 debited by 150.0 on date 05Mar24 trf to SWIGGY Refno 406512345678.")
        assertEquals(a.fingerprint, b.fingerprint)
        assertTrue(a.fingerprint.none { it !in "0123456789abcdef" })
    }
}
