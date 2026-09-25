package com.familyexpense.tracker.sms

/**
 * Merchant cleanup and rule-based categorisation.
 *
 * Deliberately no model, no network, no cost. For Indian UPI and card SMS a
 * dictionary plus a few regexes handles the overwhelming majority, instantly and
 * offline. An LLM cannot know that ATRIACONVERGENCETECH is a broadband bill --
 * that is a lookup, not reasoning -- so the dictionary is not merely the cheap
 * option, it is the more accurate one.
 *
 * Anything unmatched is left uncategorised and shown for the user to decide,
 * which is also how the dictionary grows (see [learn]).
 */
object MerchantRules {

    // Acquirer/gateway prefixes that make merchants unreadable: RAZ*SampleFood,
    // PYU*SWIGGY FOOD, PZCREDIT0000000.
    private val GATEWAY_PREFIX = Regex("""^(?:PYU|RAZ|BIL|INFT|PAYU|CCA|TPS|MSWIPE|PINELABS|SV\d*|PZ)[*_\-\s]+""", RegexOption.IGNORE_CASE)
    private val PAYZAPP = Regex("""^PZCREDIT\d*$|^PAYZAPP\d*$""", RegexOption.IGNORE_CASE)
    private val UPI_MERCHANT_PREFIX = Regex("""^@?UPI[_\-]""", RegexOption.IGNORE_CASE)

    private val NOISE = listOf(
        Regex("""\s*\(.*?\)\s*$"""),                    // trailing (...)
        Regex("""\s+Ref\s*(No|#)?.*$""", RegexOption.IGNORE_CASE),
        Regex("""\s+UPI[:\s].*$""", RegexOption.IGNORE_CASE),
        Regex("""\s+on\s+\d{1,2}[-/A-Za-z].*$""", RegexOption.IGNORE_CASE),
        Regex("""\s+at\s+\d{2}:\d{2}.*$"""),
        Regex("""[.,;:\-\s]+$""")
    )
    private val LEGAL_SUFFIX = Regex("""\s+(PVT\.?\s*LTD\.?|PRIVATE\s+LIMITED|LTD\.?|LIMITED|INDIA|IND)$""", RegexOption.IGNORE_CASE)

    /** An opaque numeric VPA is not a name; better to show nothing than noise. */
    private val OPAQUE_VPA = Regex("""^\d{10,}@|^[A-Z0-9]{18,}@""", RegexOption.IGNORE_CASE)

    /** Legal entity -> the name a person would recognise. */
    private val ALIASES: Map<String, String> = mapOf(
        "innovative retail concepts" to "BigBasket",
        "innovative retail conc" to "BigBasket",
        "atriaconvergencetech" to "ACT Fibernet",
        "zepto marketplace" to "Zepto",
        "bundl technologies" to "Swiggy",
        "ani technologies" to "Ola",
        "juspay technologies" to "Juspay",
        "sslgoogleplay" to "Google Play"
    )

    /** substring -> category. Checked against the lower-cased merchant. */
    private val CATEGORY_KEYWORDS: List<Pair<String, String>> = listOf(
        // Food
        "swiggy" to "Dining", "zomato" to "Dining", "eazydine" to "Dining",
        "dominos" to "Dining", "kfc" to "Dining", "mcdonald" to "Dining",
        "starbucks" to "Dining", "cafe" to "Dining", "restaurant" to "Dining",
        "hotel" to "Dining", "bakery" to "Dining", "biryani" to "Dining",
        // Groceries
        "bigbasket" to "Groceries", "blinkit" to "Groceries", "zepto" to "Groceries",
        "dmart" to "Groceries", "instamart" to "Groceries", "grofers" to "Groceries",
        "reliance fresh" to "Groceries", "more retail" to "Groceries",
        "supermarket" to "Groceries", "kirana" to "Groceries", "mart" to "Groceries",
        // Transport
        "uber" to "Transport", "ola" to "Transport", "rapido" to "Transport",
        "irctc" to "Transport", "metro" to "Transport", "redbus" to "Transport",
        "indigo" to "Transport", "petrol" to "Fuel", "fuel" to "Fuel",
        "hpcl" to "Fuel", "bharat petroleum" to "Fuel", "indian oil" to "Fuel",
        "iocl" to "Fuel", "shell" to "Fuel",
        // Bills and utilities
        "act fibernet" to "Utilities", "airtel" to "Utilities", "jio" to "Utilities",
        "vodafone" to "Utilities", "bescom" to "Utilities", "electricity" to "Utilities",
        "gas" to "Utilities", "broadband" to "Utilities", "bbps" to "Utilities",
        "recharge" to "Utilities", "water" to "Utilities",
        // Shopping
        "amazon" to "Shopping", "flipkart" to "Shopping", "myntra" to "Shopping",
        "ajio" to "Shopping", "nykaa" to "Shopping", "meesho" to "Shopping",
        "decathlon" to "Shopping", "ikea" to "Shopping", "metro brands" to "Shopping",
        // Health
        "pharmacy" to "Medicine", "apollo" to "Medicine", "medplus" to "Medicine",
        "pharmeasy" to "Medicine", "1mg" to "Medicine", "hospital" to "Medicine",
        "clinic" to "Medicine", "diagnostic" to "Medicine",
        // Entertainment
        "netflix" to "Entertainment", "spotify" to "Entertainment",
        "hotstar" to "Entertainment", "prime video" to "Entertainment",
        "bookmyshow" to "Entertainment", "pvr" to "Entertainment",
        "inox" to "Entertainment", "youtube" to "Entertainment",
        // Education
        "school" to "Education", "college" to "Education", "tuition" to "Education",
        "byju" to "Education", "unacademy" to "Education",
        // Faith
        "temple" to "Temple", "devasthanam" to "Temple", "tirumala" to "Temple"
    )

    /** Learned from the user's own corrections. Local only, never uploaded. */
    private val learned = mutableMapOf<String, String>()

    fun clean(raw: String?): String? {
        val trimmed = (raw ?: "").trim()
        if (trimmed.isEmpty()) return null
        if (PAYZAPP.matches(trimmed)) return "PayZapp"

        val stripped = UPI_MERCHANT_PREFIX.replace(GATEWAY_PREFIX.replace(trimmed, ""), "")
        if (OPAQUE_VPA.containsMatchIn(stripped)) return null

        // A VPA's local part is the only meaningful bit; the handle identifies the
        // app (@ybl = PhonePe), never the merchant.
        val local = if (stripped.contains("@")) stripped.substringBefore("@") else stripped

        val denoised = NOISE.fold(local) { acc, rx -> rx.replace(acc, "") }
        val name = LEGAL_SUFFIX.replace(denoised, "").trim()
        if (name.isEmpty()) return null

        return ALIASES[name.lowercase()] ?: titleCase(name)
    }

    /** @return a category name, or null to let the user choose. */
    fun categorise(merchant: String?): String? {
        val key = merchant?.lowercase()?.trim() ?: return null
        learned[key]?.let { return it }
        return CATEGORY_KEYWORDS.firstOrNull { (needle, _) -> key.contains(needle) }?.second
    }

    /** Teach it once; it remembers. This is what replaces an LLM. */
    fun learn(merchant: String, category: String) {
        learned[merchant.lowercase().trim()] = category
    }

    fun learnedPairs(): Map<String, String> = learned.toMap()

    fun restoreLearned(pairs: Map<String, String>) {
        learned.putAll(pairs)
    }

    private fun titleCase(s: String): String =
        s.split(Regex("\\s+")).joinToString(" ") { w ->
            when {
                w.length <= 3 && w.all { it.isUpperCase() } -> w   // ACT, PVR, KFC
                else -> w.lowercase().replaceFirstChar { it.uppercase() }
            }
        }
}
