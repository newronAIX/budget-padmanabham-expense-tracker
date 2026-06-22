# Visual parity

Run the mobile/web Stitch parity suite:

```sh
npm run test:visual-parity
```

The runner captures:

- `recent-activity`
- `mobile-home`
- `mobile-expenses`
- `mobile-add-expense`
- `mobile-income`
- `mobile-categories`
- `mobile-family`
- `desktop-insights`

`recent-activity` is compared against the exported Google Stitch screenshot in this folder.
For any full-screen Stitch exports, save the PNG under `tests/visual/references/` with the
matching screen name, for example `mobile-home.png`. Once the file exists, the runner turns
that screen into a pixel comparison gate automatically.

Generated target and diff images are written to `/tmp/budget-visual-parity`.
