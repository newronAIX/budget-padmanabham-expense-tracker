# Production Checklist

## Supabase

- Run `supabase/schema.sql` against the production project.
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
