# Budget Padmanabham

Mobile-first household expense tracker for families, built from the Google Stitch direction.

The app keeps daily entry simple for older family members:

- Google-only sign-in through Supabase Auth.
- One clear "Add expense" flow.
- Expense date defaults to the current date.
- Family people are separate from login users, so one signed-in person can enter expenses for elders or relatives who do not log in.
- Family dashboard, expenses, editing/deleting expenses, recurring income, categories, insights, people, invite codes, and sign out.
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
- `PRODUCTION.md` for the launch checklist.
