#!/usr/bin/env bash
# Regenerate fonts/InterVariable-subset.woff2 from the official upstream release.
#
# The app ships a subset rather than the full 352KB InterVariable because it only
# needs latin plus a couple of symbols. Result is ~68KB with both variable axes
# (wght 100-900, opsz 14-32) intact.
#
# Requires fonttools with brotli:  pip install 'fonttools[woff]' brotli
#
# Run from budget/:  ./scripts/build_font.sh
set -euo pipefail

UPSTREAM="https://rsms.me/inter/font-files/InterVariable.woff2"
OUT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/fonts"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# latin + the glyphs this app actually renders: U+20B9 rupee, U+2713 check.
UNICODES='U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+2074,U+20AC,U+20B9,U+2122,U+2191,U+2193,U+2212,U+2215,U+2713,U+FEFF,U+FFFD'

echo "Downloading $UPSTREAM"
curl -sSfL -o "$TMP/InterVariable.woff2" "$UPSTREAM"

echo "Subsetting"
pyftsubset "$TMP/InterVariable.woff2" \
  --output-file="$OUT_DIR/InterVariable-subset.woff2" \
  --flavor=woff2 \
  --layout-features='kern,liga,calt,tnum,ccmp,locl,mark,mkmk' \
  --unicodes="$UNICODES" \
  --name-IDs='*' --name-legacy --notdef-outline

mkdir -p "$OUT_DIR"
ls -l "$OUT_DIR/InterVariable-subset.woff2"

# If the metrics below ever change, update the @font-face overrides in styles.css.
python3 - "$OUT_DIR/InterVariable-subset.woff2" <<'PY'
import sys
from fontTools.ttLib import TTFont
f = TTFont(sys.argv[1])
upm, hhea = f['head'].unitsPerEm, f['hhea']
print(f"ascent-override: {hhea.ascent/upm*100:.2f}%")
print(f"descent-override: {abs(hhea.descent)/upm*100:.2f}%")
print(f"axes: {[(a.axisTag, a.minValue, a.maxValue) for a in f['fvar'].axes]}")
PY
