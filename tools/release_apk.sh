#!/usr/bin/env bash
#
# Cuts a release the family can actually receive.
#
# Three things have to move together or the update breaks, so they are done in
# one place rather than remembered:
#
#   1. versionCode goes up. Android refuses to install a build whose code is not
#      higher than the installed one.
#   2. The APK is signed with the release keystore. Same key => Android replaces
#      the app in place and keeps its data, so nobody is signed out. A different
#      key is rejected outright.
#   3. android-latest.json says the new code. That file is the only thing telling
#      an installed app an update exists.
#
# Usage:  tools/release_apk.sh [versionName]
# The version code is taken from the manifest and incremented.

set -euo pipefail
cd "$(dirname "$0")/.."

MANIFEST="budget/android-latest.json"
APK_DEST="budget/download/BudgetPadmanabham.apk"

: "${JAVA_HOME:=/Applications/Android Studio.app/Contents/jbr/Contents/Home}"
export JAVA_HOME

if ! grep -q "BUDGET_RELEASE_STORE_FILE" "$HOME/.gradle/gradle.properties" 2>/dev/null; then
  echo "No release keystore configured in ~/.gradle/gradle.properties." >&2
  echo "Without it this would build an unsigned APK that cannot upgrade anything." >&2
  exit 1
fi

CODE=$(python3 -c "import json;print(json.load(open('$MANIFEST'))['versionCode'] + 1)")
NAME="${1:-1.$CODE}"

echo "Building versionCode=$CODE versionName=$NAME"
./gradlew :app:testDebugUnitTest -q
./gradlew :app:assembleRelease -PversionCode="$CODE" -PversionName="$NAME" -q

mkdir -p "$(dirname "$APK_DEST")"
cp app/build/outputs/apk/release/app-release.apk "$APK_DEST"

# Written last, so a failed build never advertises a version that is not there.
python3 - "$CODE" "$NAME" <<'PY'
import json, sys
code, name = int(sys.argv[1]), sys.argv[2]
path = "budget/android-latest.json"
m = json.load(open(path))
m["versionCode"], m["versionName"] = code, name
json.dump(m, open(path, "w"), indent=2)
open(path, "a").write("\n")
PY

echo
echo "Wrote $APK_DEST and updated $MANIFEST."
echo "Edit the \"notes\" line in $MANIFEST -- the family reads it in the banner."
echo "Then: git add -A budget && git commit && git push   (Vercel deploys from main)"
