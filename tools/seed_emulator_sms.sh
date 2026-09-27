#!/usr/bin/env bash
# Seeds a running emulator's SMS inbox so the instrumented tests have something
# to read.
#
# Uses the emulator console (`adb emu sms send`) rather than `content insert`:
# writing to content://sms is refused on modern Android unless the caller is the
# default SMS app, and it fails SILENTLY, which looks like a parser bug.
#
#   ./tools/seed_emulator_sms.sh && ./gradlew :app:connectedDebugAndroidTest
set -euo pipefail

send() { adb emu sms send "$1" "$2" >/dev/null; sleep 2; }

# A plain bank debit. No currency token at all -- the commonest debit in India.
send "VM-SBIUPI" "Dear UPI user A/C X1234 debited by 150.0 on date 05Mar24 trf to SWIGGY Refno 406512345678. -SBI"
# Carries an amount AND a merchant, but is an OTP. Must not be booked.
send "VM-HDFCBK" "482913 is OTP for txn of INR 2499.00 at AMAZON on HDFC Bank card ending 4411. Do not share OTP"
# A wallet spend and the bank settling it, seconds apart. One payment.
send "TX-PHONPE" "You've paid Rs.251 via PhonePe wallet for DREAM11. Remaining balance: Rs.750."
send "VM-HDFCBK" "Spent Rs.251 On HDFC Bank Card 0000 At DREAM11 On 2026-09-27:10:15:00"
# A human. Must be rejected on the sender, before the body is read.
send "+919876500000" "Amma, I sent you Rs 500 for groceries"
# Declined: no money moved.
send "VM-RBLBNK" "ALERT: Your transaction for INR 1793.00 at ROLLA HYPER MARKET was declined"

echo "seeded $(adb shell content query --uri content://sms/inbox --projection address | wc -l | tr -d ' ') messages"
