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
enum class SenderKind {
    /** The account holder's bank. Authoritative: money really moved. */
    BANK,
    /** Stored-value wallet. A spend is real, but a top-up is a transfer, and the
     *  bank sent its own SMS for that top-up. */
    WALLET,
    /** Buy-now-pay-later. Sends THREE messages per purchase: the purchase, the
     *  later bank settlement, and its own receipt. Only the first is an expense. */
    BNPL,
    /** Only ever sends collect requests and awareness notices, never a
     *  completed payment. Nothing here should create a transaction. */
    REQUEST_ONLY
}

object SmsSenders {

    private val SENDER = Regex("""^(?:[A-Z]{2}-)?([A-Z0-9]{4,6})(?:-[STPG])?$""", RegexOption.IGNORE_CASE)
    private val PHONE = Regex("""^\+?\d[\d\s-]{6,}$""")

    /**
     * header -> (display name, kind). Prefix match on SBI* because SBI alone
     * operates 272 registered headers.
     *
     * Verified against TRAI's official DLT registry. Several plausible-looking
     * headers do NOT exist and were removed rather than guessed at: there is no
     * BHIMUP, no MBKWIK, no SIMPLB, and no AMZNPY. Google Pay has no header at
     * all -- it sends no transaction SMS, so every "Google Pay" alert a user
     * receives actually comes from their bank.
     */
    private val HEADERS: Map<String, Pair<String, SenderKind>> = mapOf(
        "HDFCBK" to ("HDFC Bank" to SenderKind.BANK), "HDFCBN" to ("HDFC Bank" to SenderKind.BANK),
        "HDFCCC" to ("HDFC Bank" to SenderKind.BANK), "HDFCDC" to ("HDFC Bank" to SenderKind.BANK),
        "HDFCBA" to ("HDFC Bank" to SenderKind.BANK), "HDFCAL" to ("HDFC Bank" to SenderKind.BANK),
        "PAYZAP" to ("HDFC PayZapp" to SenderKind.WALLET),
        "SBIINB" to ("SBI" to SenderKind.BANK), "SBIUPI" to ("SBI" to SenderKind.BANK),
        "ATMSBI" to ("SBI" to SenderKind.BANK), "SBIPSG" to ("SBI" to SenderKind.BANK),
        "SBIBNK" to ("SBI" to SenderKind.BANK), "SBYONO" to ("SBI" to SenderKind.BANK),
        "SBICRD" to ("SBI Card" to SenderKind.BANK),
        "ICICIB" to ("ICICI Bank" to SenderKind.BANK), "ICICBK" to ("ICICI Bank" to SenderKind.BANK),
        "ICIBNK" to ("ICICI Bank" to SenderKind.BANK), "ICICIT" to ("ICICI Bank" to SenderKind.BANK),
        "AXISBK" to ("Axis Bank" to SenderKind.BANK), "AXISB" to ("Axis Bank" to SenderKind.BANK),
        "AXISIN" to ("Axis Bank" to SenderKind.BANK), "AXISSR" to ("Axis Bank" to SenderKind.BANK),
        "KOTAKB" to ("Kotak" to SenderKind.BANK), "KBANKT" to ("Kotak" to SenderKind.BANK),
        "KOTAKP" to ("Kotak" to SenderKind.BANK), "KOTAK" to ("Kotak" to SenderKind.BANK),
        "PNBSMS" to ("PNB" to SenderKind.BANK), "PNBCRD" to ("PNB" to SenderKind.BANK),
        "PNBBNK" to ("PNB" to SenderKind.BANK), "PUNBN" to ("PNB" to SenderKind.BANK),
        "BOBTXN" to ("Bank of Baroda" to SenderKind.BANK), "BOBSMS" to ("Bank of Baroda" to SenderKind.BANK),
        "BOBUPI" to ("Bank of Baroda" to SenderKind.BANK), "BOBCRD" to ("BOBCARD" to SenderKind.BANK),
        "BOBONE" to ("BOBCARD" to SenderKind.BANK),
        "CANBNK" to ("Canara Bank" to SenderKind.BANK), "CAANBK" to ("Canara Bank" to SenderKind.BANK),
        "UNIONB" to ("Union Bank" to SenderKind.BANK),
        "INDUSB" to ("IndusInd" to SenderKind.BANK), "INDUSA" to ("IndusInd" to SenderKind.BANK),
        "INDUSO" to ("IndusInd" to SenderKind.BANK),
        "YESBNK" to ("Yes Bank" to SenderKind.BANK), "YESBCC" to ("Yes Bank" to SenderKind.BANK),
        "YESPAY" to ("Yes Bank" to SenderKind.BANK),
        "IDFCFB" to ("IDFC FIRST" to SenderKind.BANK), "IDFCBK" to ("IDFC FIRST" to SenderKind.BANK),
        "IDFCFZ" to ("IDFC FIRST" to SenderKind.BANK),
        "RBLBNK" to ("RBL Bank" to SenderKind.BANK), "RBLCRD" to ("RBL Bank" to SenderKind.BANK),
        "RBLCCC" to ("RBL Bank" to SenderKind.BANK),
        "FEDBNK" to ("Federal Bank" to SenderKind.BANK), "FEDSMS" to ("Federal Bank" to SenderKind.BANK),
        "FEDSCP" to ("Federal Bank" to SenderKind.BANK),
        "AMEXIN" to ("American Express" to SenderKind.BANK), "AMEXBK" to ("American Express" to SenderKind.BANK),
        // Paytm Payments Bank IS a bank; the wallet below is a different entity.
        "PAYTMB" to ("Paytm Payments Bank" to SenderKind.BANK),
        "SLICEI" to ("slice" to SenderKind.BANK),

        // --- wallets: a spend is real, a top-up is a transfer ---
        // PHONPE, not PHONEPE -- DLT headers are exactly six characters.
        "PHONPE" to ("PhonePe" to SenderKind.WALLET), "PHONEP" to ("PhonePe" to SenderKind.WALLET),
        "IPAYTM" to ("Paytm Wallet" to SenderKind.WALLET), "VPAYTM" to ("Paytm Wallet" to SenderKind.WALLET),
        "BPAYTM" to ("Paytm Wallet" to SenderKind.WALLET), "FPAYTM" to ("Paytm Wallet" to SenderKind.WALLET),
        "MOBIKW" to ("MobiKwik" to SenderKind.WALLET),
        "AMZPAY" to ("Amazon Pay" to SenderKind.WALLET), "AMZPOD" to ("Amazon Pay" to SenderKind.WALLET),
        "AMZSNP" to ("Amazon Pay" to SenderKind.WALLET), "AMAZON" to ("Amazon Pay" to SenderKind.WALLET),
        "JUSPAY" to ("Amazon Pay" to SenderKind.WALLET),
        "CREDIN" to ("CRED" to SenderKind.WALLET), "CRED" to ("CRED" to SenderKind.WALLET),

        // --- BNPL: three messages per purchase ---
        "SMPLPL" to ("Simpl" to SenderKind.BNPL), "SIMPLP" to ("Simpl" to SenderKind.BNPL),
        "GTSMPL" to ("Simpl" to SenderKind.BNPL), "GSIMPL" to ("Simpl" to SenderKind.BNPL),
        "SIMPLX" to ("Simpl" to SenderKind.BNPL),
        "LZYPAY" to ("LazyPay" to SenderKind.BNPL), "LAZPAY" to ("LazyPay" to SenderKind.BNPL),

        // --- collect requests only, never a completed payment ---
        "NPCIBM" to ("BHIM" to SenderKind.REQUEST_ONLY), "BHIMAP" to ("BHIM" to SenderKind.REQUEST_ONLY),
        "NPCIBH" to ("BHIM" to SenderKind.REQUEST_ONLY), "NPCICA" to ("BHIM" to SenderKind.REQUEST_ONLY)
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
    fun identify(sender: String?): Pair<String, SenderKind>? {
        val raw = (sender ?: "").trim()
        if (raw.isEmpty() || PHONE.matches(raw)) return null
        val header = SENDER.find(raw)?.groupValues?.get(1)?.uppercase() ?: return null
        if (header in OTP_ONLY) return null
        HEADERS[header]?.let { return it }
        // SBI operates hundreds of headers; the prefix is dependable where the
        // exact one is not. Deliberately NOT done for other brands: matching on
        // a substring would map MDKWIK (a finance company) onto MobiKwik.
        if (header.startsWith("SBI")) return "SBI" to SenderKind.BANK
        return null
    }

    fun bankFor(sender: String?): String? = identify(sender)?.first

    fun isKnownBank(sender: String?): Boolean = identify(sender)?.second == SenderKind.BANK
}
