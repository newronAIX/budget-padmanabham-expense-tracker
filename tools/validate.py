"""Validate the ACTUAL regex patterns from SmsParser.kt against real SMS fixtures.

Patterns are extracted from the Kotlin source rather than retyped, so this
tests what the app will really run. Java and Python regex agree on everything
used here; the only syntax difference is named groups, converted below.
"""
import re, sys, pathlib

SRC = pathlib.Path("app/src/main/java/com/familyexpense/tracker/sms")
parser_kt = (SRC / "SmsParser.kt").read_text()
excl_kt = (SRC / "SmsExclusions.kt").read_text()

def j2p(p):
    return p.replace("(?<", "(?P<").replace("(?P<=", "(?<=").replace("(?P<!", "(?<!")

# The shared amount sub-pattern.
AMT = re.search(r'private const val AMT = """(.+?)"""', parser_kt, re.S).group(1)

# Templates, in source order: name, direction, instrument, pattern.
tmpl_re = re.compile(
    r'Template\(\s*"([^"]+)",\s*Direction\.(\w+),\s*Instrument\.(\w+),\s*\n?\s*re\("""(.+?)"""',
    re.S)
TEMPLATES = []
for name, direction, instr, pat in tmpl_re.findall(parser_kt):
    TEMPLATES.append((name, direction, j2p(pat.replace("$AMT", AMT))))

# Exclusion rules.
EXCL = [(n, j2p(p)) for n, p in
        re.findall(r'"([a-z_]+)" to re\("""(.+?)"""\s*\)', excl_kt, re.S)]
FAILED = j2p(re.search(r'private val FAILED = re\("""(.+?)"""\s*\)', excl_kt, re.S).group(1))
COMPLETED = j2p(re.search(r'private val COMPLETED_CREDIT = re\("""(.+?)"""\s*\)', excl_kt, re.S).group(1))
MONEYVERB = j2p(re.search(r'private val MONEY_VERB = re\("""(.+?)"""\s*\)', excl_kt, re.S).group(1))

F = re.I | re.S
def excluded(body):
    for n, p in EXCL:
        if re.search(p, body, F): return n
    if re.search(FAILED, body, F) and not re.search(COMPLETED, body, F): return "failed_txn"
    if not re.search(MONEYVERB, body, F): return "no_money_verb"
    return None

def amount_paise(raw):
    c = raw.replace(",", "").strip()
    if not c or c == ".": return None
    parts = c.split(".")
    rupees = int(parts[0] or "0")
    paise = int((parts[1] + "00")[:2]) if len(parts) > 1 and parts[1] else 0
    return rupees * 100 + paise

def parse(body):
    ex = excluded(body)
    if ex: return ("EXCLUDED", ex, None)
    for name, direction, pat in TEMPLATES:
        m = re.search(pat, body, F)
        if not m: continue
        p = amount_paise(m.group(1))
        if not p or p <= 0: continue
        merch = None
        if "merchant" in (m.groupdict() or {}):
            merch = (m.groupdict().get("merchant") or "").strip() or None
        return (direction, name, (p / 100.0, merch))
    return ("NO_MATCH", None, None)

bad = []
for n, pat in EXCL:
    try: re.compile(pat, F)
    except re.error as e: bad.append(("exclusion", n, str(e), pat[:90]))
for n, d, pat in TEMPLATES:
    try: re.compile(pat, F)
    except re.error as e: bad.append(("template", n, str(e), pat[:90]))
if bad:
    print("PATTERNS THAT DO NOT COMPILE:")
    for kind, n, err, snip in bad: print(f"  [{kind}] {n}: {err}\n      {snip}")
    sys.exit(2)
print(f"loaded {len(TEMPLATES)} templates, {len(EXCL)} exclusion rules -- all compile\n")

CASES = [
 # (label, body, expect_direction, expect_amount)
 ("sbi_upi (no currency!)", "Dear UPI user A/C X1234 debited by 150.0 on date 05Mar24 trf to SWIGGY Refno 406512345678. If not u? call 1800111109. -SBI", "DEBIT", 150.0),
 ("hdfc_sent multiline", "Sent Rs.100.00\nFrom HDFC Bank A/C *0000\nTo CUSTOMER NAME\nOn 17/05/26\nRef 000000000000", "DEBIT", 100.0),
 ("hdfc PZCREDIT trap", "Spent Rs.3000 From HDFC Bank Card x0000 At PZCREDIT0000000 On 2026-05-02:00:17:56 Bal Rs.142.26", "DEBIT", 3000.0),
 ("icici 'X credited' trap", "ICICI Bank Acct XX000 debited for Rs 14.00 on 09-May-26; Pune Metro credited. UPI:000000000000.", "DEBIT", 14.0),
 ("axis P2M", "INR 726.00 debited A/c no. XX1234 05-09-26, 10:19:49 UPI/P2M/000000000000/RAHUL SHARMA Not you? Axis Bank", "DEBIT", 726.0),
 ("bob Dr.", "Rs.230.00 Dr. from A/C XXXXXX1234 and Cr. to example@okbank. Ref:000000000000. AvlBal:Rs618.85", "DEBIT", 230.0),
 ("union Rs: colon", "Union Bank of India A/c *0000 Debited Rs:151.00 on 25-08-2026 09:50:01 by Mob Bk ref no 000000000000, Fvg: RAHUL SHARMA Avl Bal Rs:7138.46.", "DEBIT", 151.0),
 ("lakh grouping", "Rs.1,23,456.78 spent on HDFC Bank Card x0000 at BIG STORE on 2026-07-12:17:00:56.", "DEBIT", 123456.78),
 ("icici card w/ EMI words", "Rs 100.00 spent on ICICI Bank Card XX0000 on 16-May-26 at SAMPLE MERCHANT. Avl Lmt: Rs 200.00. To convert this txn to EMI give a missed call. Know more about EMI conversion.", "DEBIT", 100.0),
 ("sbi card", "Rs.259.00 spent on your SBI Credit Card ending with 1234 on 15Jan26. Your available limit is Rs.1,235.00.", "DEBIT", 259.0),
 ("amex spelled date", "Alert: You've spent INR 4,411.00 on your AMEX Corp Card ** 21006 at CWT INDIA on 8 January 2026 at 11:29 PM IST.", "DEBIT", 4411.0),
 ("kotak sent", "Sent Rs.500.00 from Kotak Bank A/c X0000 to SampleCo Services Ind on 10-09-26. UPI Ref 000000000000.", "DEBIT", 500.0),
 ("federal ATM withdrawn@", "Rs 1500 withdrawn@ YBL CHAN on 21JAN26 17:59 Bal Rs 7517.94 Ref 602117126490.", "DEBIT", 1500.0),
 ("hdfc credit", "Credit Alert!\nRs.1.00 credited to HDFC Bank A/c XX0000 on 09-05-26\nfrom VPA customer@bank (UPI 000000000000)", "CREDIT", 1.0),
 ("sbi credit", "Dear SBI User, your A/c X0000-credited by Rs.12345 on 28Jul26 transfer from Sample Name Ref No 123456789012 -SBI", "CREDIT", 12345.0),
 ("refund credit", "Alert! Rs. 262.56 refunded by SampleMerchant Payments BANGALORE IND on 17/MAY/2026 & adjusted against HDFC Bank Credit Card 0000", "CREDIT", 262.56),
 ("reversal despite 'failed'", "Rs 500.00 reversed and credited back to your A/c XX5678 on 23-09-26 for failed UPI txn Ref 626512349999. -SBI", "CREDIT", 500.0),
]

REJECT = [
 ("OTP with amount+merchant", "482913 is OTP for txn of INR 2,499.00 at AMAZON on HDFC Bank card ending 4411. Do not share OTP"),
 ("e-mandate future", "E-Mandate!\nRs.3821.00 will be deducted on 02/03/26\nFor Rentomojo mandate\nUMN 6cc417@ybl"),
 ("failed txn", "Dear Customer, txn of Rs.637.70 thru A/C XX1234 on 18-8-26 to ACME STORE failed due to INSUFFICIENT FUNDS-Canara Bank"),
 ("declined", "ALERT: Credit limit exceeded. Your transaction for INR 1,793.00 at ROLLA HYPER MARKET was declined"),
 ("statement ready", "Hi, Your April-2026 bill of Rs.7,777.77 is ready. Please pay by 05 May, 2026 through the OneCard app."),
 ("due reminder", "Payment of Equitas Credit Card 0000 is due on 10/07/26. Min due Rs 1234.56 Total due Rs 12345.67."),
 ("ASBA lien", "Your ASBA application for SAMPLEIPO is received and Application value of Rs 14999 is blocked in your registered Bank account"),
 ("future refund", "Refund of Rs 1,299 for your order has been processed and will be credited to your ICICI Bank card in 3-5 days."),
]

p = f = 0
for label, body, want_dir, want_amt in CASES:
    d, name, got = parse(body)
    ok = d == want_dir and got and abs(got[0] - want_amt) < 0.005
    print(f"  {'PASS' if ok else 'FAIL'}  {label:32} -> {d:9} {got[0] if got else '-':>10} [{name}]"
          + ("" if ok else f"   WANT {want_dir} {want_amt}"))
    p, f = (p+1, f) if ok else (p, f+1)

print()
for label, body in REJECT:
    d, name, got = parse(body)
    ok = d in ("EXCLUDED", "NO_MATCH")
    print(f"  {'PASS' if ok else 'FAIL'}  reject {label:25} -> {d} [{name}]")
    p, f = (p+1, f) if ok else (p, f+1)

print(f"\n  passed {p}   failed {f}")
sys.exit(1 if f else 0)
