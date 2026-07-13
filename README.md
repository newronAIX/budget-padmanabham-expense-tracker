# Budget Padmanabham (Android + Web + Supabase)

A Kotlin + Jetpack Compose Android app starter that implements your requested product features:

1. Email sign in / sign up with family invite support.
2. Daily notification reminder when user has not logged expense for the day.
3. Shared categories editable by any family member.
4. Big center-bottom `+` button with add-expense popup (`name`, `category`, `amount`, `notes`).
5. Family owner sets currency before inviting members.
6. Supabase backend (Auth + Postgres + RLS).
7. Metrics tab (who spent how much, total income/expense, net savings).
8. Charts tab (pie chart by category + spend-share bars by member).
9. Income tab for monthly recurring incomes (add/edit/activate/deactivate) with income categories.
10. Account tab for invites and sign out.
11. Expense editing and monthly/yearly metrics.
12. Shared expense payload encryption using a family-scoped secret and strict RLS.

## Tech Stack

- Kotlin
- Jetpack Compose (Material 3)
- Android WorkManager for daily reminders
- DataStore for local app/session state
- Ktor client for Android Supabase Auth/REST API calls
- Static web app using Supabase Auth/REST API calls

## Project Structure

- `app/src/main/java/com/familyexpense/tracker/MainActivity.kt`
- `app/src/main/java/com/familyexpense/tracker/ui/AppRoot.kt`
- `app/src/main/java/com/familyexpense/tracker/ui/AppViewModel.kt`
- `app/src/main/java/com/familyexpense/tracker/data/ExpenseRepository.kt`
- `app/src/main/java/com/familyexpense/tracker/data/SupabaseApi.kt`
- `app/src/main/java/com/familyexpense/tracker/worker/DailyReminderWorker.kt`
- `web/index.html`
- `web/app.js`
- `web/styles.css`
- `supabase/schema.sql`

## Supabase Setup

1. Create a Supabase project.
2. In Supabase SQL editor, run `supabase/schema.sql`.
3. In Supabase Auth settings:
   - Enable Email provider.
   - For easier testing, disable email confirmation (or handle email confirmation in app).
4. Put your keys in local Gradle properties (recommended in `~/.gradle/gradle.properties`):

```properties
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_ANON_KEY=YOUR_ANON_KEY
```

If you already ran an older schema version, run `supabase/schema.sql` again to apply:
- `INR` default family currency
- category `scope` (`EXPENSE`/`INCOME`)
- income `category_id`
- `income_view` for category-aware recurring income reads
- family `expense_secret` and expense update policy

## Run

### Android

1. Open the project in Android Studio.
2. Sync Gradle.
3. Run on Android device/emulator (API 26+).
4. Allow notifications when prompted.

### Web

The web app is static and has no build step.

1. Open `web/index.html` in a browser, or serve the folder with any static server.
2. Sign in or sign up.
3. Use `Settings` only if you need to change the Supabase URL or anon key.

Optional local config file:

```js
// web/config.js
window.BUDGET_PADMANABHAM_CONFIG = {
  SUPABASE_URL: "https://svgyjfqpgleywjjnqpda.supabase.co",
  SUPABASE_ANON_KEY: "YOUR_ANON_KEY"
};
```

`web/config.js` is gitignored so a local key is not accidentally committed.

## Supabase Troubleshooting

If login or family setup fails, check these first:

1. Re-run `supabase/schema.sql` in the Supabase SQL editor. The app expects `families`, `family_members`, `categories`, `expenses`, `incomes`, `family_invites`, `expense_view`, `income_view`, and their RLS policies.
2. In Supabase Auth, enable the Email provider.
3. For testing, disable email confirmation. If email confirmation is enabled, sign-up succeeds but no login session is returned until the email is confirmed.
4. For Android, rebuild and reinstall after changing `SUPABASE_URL` or `SUPABASE_ANON_KEY`; those values are compiled into `BuildConfig`.
5. For web, update `Settings` or `web/config.js` with the current anon/publishable key.

## UX Notes Implemented

- Minimal-friction add expense flow from global FAB.
- Owner-only invite card in Expenses tab.
- Family setup split into "Create family" and "Join via invite code".
- Metrics and charts organized in dedicated tabs for fast scanning.
- Income tab supports recurring monthly entry and updates.

## Next Recommended Enhancements

- Share invite code with Android Share Sheet.
- Push notifications using FCM + Supabase Edge Functions.
- Month filters and export (CSV/PDF).
- Better charting library integration for richer analytics.
- Offline-first caching with Room.
