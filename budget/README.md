# Budget Padmanabham

Mobile-first household expense tracker for families, built from the Google Stitch direction.

The app keeps daily entry simple for older family members:

- Google-only sign-in through Supabase Auth.
- One clear "Add expense" flow.
- Expense date defaults to the current date.
- Invite-code family setup with moderator approval, member removal, invite locking, and invite rotation.
- Family dashboard, expenses, editing/deleting expenses, recurring income, categories, budget limits, savings goals, insights, invite codes, and sign out.
- Browser-side family encryption for family names, member display names, categories, monthly plans, expenses, income, and analytics snapshots.
- Large touch targets and plain labels.

## Run Locally

```sh
cd budget
npm run start
```

Open `http://localhost:5188`.

For design review screenshots without signing in, open:

```text
http://localhost:5188/?preview=1
```

## Configure Supabase

1. Run `supabase/schema.sql` in the Supabase SQL editor, or apply it through the Supabase connector.
2. Copy `config.example.js` to `config.js` and fill in the Supabase URL and publishable key.
3. Enable Google under Supabase Dashboard > Authentication > Sign In / Providers.
4. Create a Google OAuth Web Client in Google Cloud.
5. Add these Google OAuth settings while developing:
   - Authorized JavaScript origin: `http://localhost:5188`
   - Authorized redirect URI: `https://YOUR_PROJECT.supabase.co/auth/v1/callback`
6. Paste the Google Client ID and Client Secret into the Supabase Google provider settings.

Free Supabase is enough for MVP testing. Pro is useful later for no project pausing, larger quotas, higher reliability options, custom domain polish, and production support.

## Production

Run the local check before deploying:

```sh
npm run check
```

Production hardening files are included:

- `vercel.json` for Vercel headers and SPA fallback.
- `_headers` and `_redirects` for compatible static hosts.
- `site.webmanifest` and `favicon.svg` for mobile web polish.
- `terms.html` for user-facing terms, privacy, and data collection policy.
- `PRODUCTION.md` for the launch checklist.

## Privacy Model

Approved family members unlock the family ledger in the browser with the shared family privacy password. Supabase stores authentication and operational metadata, plus encrypted payloads for family content. The database owner can still see metadata such as emails, user ids, row ids, timestamps, invite status, and encrypted text, but should not be able to read encrypted family content without the family privacy password.

Existing legacy plaintext rows are migrated to encrypted payloads after an approved family member opens the updated app and unlocks the family. If all approved members lose the family privacy password, encrypted content cannot be recovered.
