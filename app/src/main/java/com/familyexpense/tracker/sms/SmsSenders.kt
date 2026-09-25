package com.familyexpense.tracker.sms

/**
 * Which senders are banks, and which are not worth reading.
 *
 * Indian DLT sender IDs look like VM-HDFCBK-S:
 *   VM      operator + telecom circle -- NOT stable, the same bank arrives under
 *           JD-, JM-, VM- and VD- on different days, so it must be ignored
 *   HDFCBK  the registered 6-char header -- the only dependable part
 *   -S      category suffix added by TRAI in May 2025
 *
 * The suffix is NOT filtered on. Transaction alerts overwhelmingly arrive as -S
 * (Service), not -T, so requiring -T would drop nearly everything real.
 */
object SmsSenders {

    private val SENDER = Regex("""^(?:[A-Z]{2}-)?([A-Z0-9]{4,6})(?:-[STPG])?$""", RegexOption.IGNORE_CASE)
    private val PHONE = Regex("""^\+?\d[\d\s-]{6,}$""")

    /** header -> display name. Prefix match on SBI* because SBI alone has 272 headers. */
    private val HEADERS: Map<String, String> = mapOf(
        "HDFCBK" to "HDFC Bank", "HDFCBN" to "HDFC Bank", "HDFCCC" to "HDFC Bank",
        "HDFCDC" to "HDFC Bank", "HDFCBA" to "HDFC Bank", "HDFCAL" to "HDFC Bank",
        "PAYZAP" to "HDFC PayZapp",
        "SBIINB" to "SBI", "SBIUPI" to "SBI", "ATMSBI" to "SBI", "SBIPSG" to "SBI",
        "SBIBNK" to "SBI", "SBYONO" to "SBI", "SBICRD" to "SBI Card",
        "ICICIB" to "ICICI Bank", "ICICBK" to "ICICI Bank", "ICIBNK" to "ICICI Bank",
        "ICICIT" to "ICICI Bank",
        "AXISBK" to "Axis Bank", "AXISB" to "Axis Bank", "AXISIN" to "Axis Bank",
        "AXISSR" to "Axis Bank",
        "KOTAKB" to "Kotak", "KBANKT" to "Kotak", "KOTAKP" to "Kotak",
        "PNBSMS" to "PNB", "PNBCRD" to "PNB", "PNBBNK" to "PNB", "PUNBN" to "PNB",
        "BOBTXN" to "Bank of Baroda", "BOBSMS" to "Bank of Baroda",
        "BOBUPI" to "Bank of Baroda", "BOBCRD" to "BOBCARD", "BOBONE" to "BOBCARD",
        "CANBNK" to "Canara Bank", "CAANBK" to "Canara Bank",
        "UNIONB" to "Union Bank",
        "INDUSB" to "IndusInd", "INDUSA" to "IndusInd", "INDUSO" to "IndusInd",
        "YESBNK" to "Yes Bank", "YESBCC" to "Yes Bank", "YESPAY" to "Yes Bank",
        "IDFCFB" to "IDFC FIRST", "IDFCBK" to "IDFC FIRST", "IDFCFZ" to "IDFC FIRST",
        "RBLBNK" to "RBL Bank", "RBLCRD" to "RBL Bank", "RBLCCC" to "RBL Bank",
        "FEDBNK" to "Federal Bank", "FEDSMS" to "Federal Bank", "FEDSCP" to "Federal Bank",
        "AMEXIN" to "American Express", "AMEXBK" to "American Express",
        "CREDIN" to "CRED", "CRED" to "CRED",
        "LZYPAY" to "LazyPay", "PAYTMB" to "Paytm", "JIOPAY" to "Jio Payments",
        "SLICEI" to "slice", "JUSPAY" to "Juspay"
    )

    /** Headers that only ever carry OTPs. Cheaper to drop by sender than by body. */
    private val OTP_ONLY = setOf("SBIOTP", "ICIOTP", "PNBOTP", "FEDOTP", "MYAMEX")

    /**
     * Returns the bank name, or null if this sender should not be parsed at all.
     *
     * Rejecting plain phone numbers is the single highest-value anti-fraud rule in
     * this market: a genuine bank alert never arrives from a mobile number, so
     * anything that does is a scam imitating one.
     */
    fun bankFor(sender: String?): String? {
        val raw = (sender ?: "").trim()
        if (raw.isEmpty() || PHONE.matches(raw)) return null
        val header = SENDER.find(raw)?.groupValues?.get(1)?.uppercase() ?: return null
        if (header in OTP_ONLY) return null
        HEADERS[header]?.let { return it }
        // SBI operates hundreds of headers; the prefix is dependable where the
        // exact header is not.
        if (header.startsWith("SBI")) return "SBI"
        return null
    }

    fun isKnownBank(sender: String?): Boolean = bankFor(sender) != null
}
