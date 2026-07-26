# Production Checklist

Live at https://budget-padmanabham.vercel.app, deployed from `main` by the Vercel
git integration. Every merge to `main` ships; there is no manual CLI step any more.

## Supabase

- Run `supabase/schema.sql` against the production project.
  - Order matters. The file drops `join_budget_invite` and `review_budget_join_request`,
    which the previous release calls to let someone join a family. Running it before that
    release is replaced breaks joining until the new build is live. Deploy the app first,
    or add `join_budget_family` on its own and drop the two old functions afterwards.
  - New members cannot join until `budget_families.key_fingerprint` is filled in. It is
    written automatically the first time an existing member opens the new build and
    unlocks, once per family. Until then joining fails with "This family is not ready for
    new members yet".
- Confirm every `budget_*` table has RLS enabled.
- Confirm the Data API exposes the `public` schema and `authenticated` has the grants from the schema file.
- In Authentication > URL Configuration:
  - Site URL: production app URL.
  - Redirect URLs: production app URL and local development URL.
- In Authentication > Providers > Google:
  - Enable Google.
  - Paste the Google Web OAuth Client ID and Client Secret.
  - Keep only `openid`, email, and profile scopes unless more access is truly needed.
- Optional on Supabase Pro:
  - Keep JWT expiry near the default 1 hour.
  - Add inactivity timeout if family data needs stricter session controls.

## Google Cloud

- Create OAuth Client ID with type `Web application`.
- Authorized JavaScript origins:
  - Production origin, for example `https://budget.example.com`.
  - Local development origin, for example `http://localhost:5188`.
- Authorized redirect URI:
  - `https://YOUR_PROJECT.supabase.co/auth/v1/callback`
- Configure OAuth branding before sharing with family users.

## Hosting

- Deploy the contents of this `budget` folder.
- On Vercel, set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` as environment variables for
  Production and Preview. The build runs `scripts/write_config.mjs`, which generates
  `config.js` from them and fails the build if either is missing.
- Root Directory can be either the repository root or `budget`. The root `vercel.json`
  builds this folder from the top; `budget/vercel.json` is used when Root Directory is set
  to `budget`. Keep the `headers` and `rewrites` blocks identical in the two files, since
  Vercel reads only one of them per deployment.
- Vercel validates `vercel.json` against a closed schema. Any key it does not recognise
  fails the deployment before the build starts, so do not add comment keys.
- Make sure `config.js` exists in the deployed output and is not committed to git.
- Confirm security headers from `vercel.json` or `_headers` are active.
- Confirm `/` loads, `/?preview=1` still works for design review, and normal `/` shows only Gmail login.

## Smoke Test

- Sign in with Gmail.
- Create a family.
- Add, edit, and delete one expense.
- Add one family person.
- Create an invite code.
- Sign out, sign back in, and confirm data persists.
