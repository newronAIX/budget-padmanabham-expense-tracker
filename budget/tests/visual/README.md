# Visual checks

There are two modes, and they answer different questions. Reach for the right one.

## `npm run test:visual` — regression gate (use this while refactoring)

Compares the app against **its own previously recorded output** in `baseline/`.

```sh
npm run test:visual              # did my change alter rendering?
npm run test:visual:update       # accept current output as the new baseline
```

Rendering is deterministic here — all 11 screens reproduce at exactly `mae 0.0`
across independent runs — so the gate demands **pixel identity** by default.
That is intentional. A "generous" tolerance is worse than no gate: rounding the
corners on three small avatars moves only `0.046%` of pixels, so a 0.1% threshold
passes a change that is plainly visible on screen.

When a stage is *expected* to move pixels (a spacing or type pass), relax it
deliberately and review the diff PNGs by hand:

```sh
python3 scripts/visual_parity.py --mode baseline --max-changed-percent 5
```

Then re-record with `npm run test:visual:update` once the diffs look right.

**Baselines are committed.** They are the record of what the app looked like, so
they belong in git alongside the code that produces them (~950 KB for 11 screens).

## `npm run test:visual-parity` — design fidelity (informational)

Compares against the original Google Stitch mockups in `references/`. This measures
*how close the app is to the design target*, not whether it regressed, so it does
not gate refactors and may sit below threshold indefinitely. `recent-activity`
compares against `stitch-recent-activity.png` in this folder.

## The frozen clock

Preview data is date-relative (`daysAgo()`, `todayKey()`), so screenshots would
otherwise drift overnight and hard-fail at month boundaries. Every preview URL is
pinned via `?today=` to `FROZEN_TODAY` in `scripts/visual_parity.py`.

`?today=` is honoured **only** when `preview=1` is set, so the real app can never
be pinned to a fake date. Changing `FROZEN_TODAY` invalidates every baseline.

## Screens covered

`recent-activity`, `mobile-home`, `mobile-expenses`, `mobile-insights`,
`mobile-add-expense`, `mobile-income`, `mobile-categories`, `mobile-family`,
`desktop-insights`, `desktop-home`, `desktop-expenses`.

Desktop matters independently: above the 900px breakpoint the app branches to
entirely different render functions (`mobileInsightsScreen` vs `insightsScreen`),
so a mobile-only screenshot set leaves half the UI unchecked.

## Requirements

Python (`numpy`, `Pillow`) and a Node with `playwright` available. The runner
finds Node in this order: `$BUDGET_VISUAL_NODE`, a local `playwright` install,
then a bundled agent runtime. If none work it prints how to fix it:

```sh
npm install --no-save playwright && npx playwright install chromium
```

Target and diff images land in `/tmp/budget-visual-parity` (override with `--out`).
