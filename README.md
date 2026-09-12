# Rawdatik — روضتك

Multi-tenant management platform for Algerian nurseries, kindergartens and
specialised centres: online enrolment, daily attendance and kiosk check-in,
invoicing in dinars, accounting and payroll, a parent portal, and the printable
registers an inspection asks for. Arabic first, then English, then French.

Stack: Next.js 16 (App Router), TypeScript, Tailwind v4 + shadcn/ui,
next-intl, Supabase (Postgres with row-level security as the only permission
layer, auth, private storage). Deployed on Vercel.

## Running it locally

```bash
npm install
cp .env.example .env.local        # then fill in the two Supabase values
npm run dev                       # http://localhost:3000
```

The database is the shared Supabase project described in
[`supabase/README.md`](supabase/README.md); there is no local Postgres to
start. Every table, function and policy lives in `supabase/migrations/*.sql`,
numbered and applied in order — read the schema there before writing a query.
Migrations are **never** applied by the app or by a script: the maintainer
reviews and applies each file to production by hand.

Useful commands:

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build (needs `.env.local`) |
| `npx tsc --noEmit` | Type check, must be clean |
| `npm run lint` | ESLint, must report no errors |
| `npm run check:messages` | Message parity across `messages/{ar,en,fr}` and keys used in code but defined nowhere — must say OK |
| `npm run shots` | Re-captures the guide screenshots against the demo tenant (see the script header) |

## Environment variables

Every variable the code reads is listed, with its purpose, in
[`.env.example`](.env.example). In short:

| Variable | Required | Where it is read |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes — the middleware fails closed without them | `src/lib/env.ts`, `src/middleware.ts` |
| `NEXT_PUBLIC_APP_URL` | yes for a deployment — absolute links on enrolment posters, staff invites, the parent access card | settings/enrollment, staff/invites, `staff/actions.ts`, `guardian-portal-access.tsx` |
| `NEXT_PUBLIC_GOOGLE_MAPS_KEY` | no — the establishment card degrades to address + directions link | `map-embed.tsx` |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | no — web push stays off, in-app notifications keep working | `push-toggle.tsx`, `src/lib/push-server.ts` |
| `PUSH_DISPATCH_SECRET` | no — but push never sends without it; must match the `kg_push_config` row | `src/lib/push-server.ts`, `/api/push/dispatch` |
| `CRON_SECRET` | Vercel injects it; do not set locally — it only authorises the Vercel Cron backstop | `/api/push/dispatch` |

`NEXT_PUBLIC_*` values are inlined into the browser bundle at build time: never
put a secret in one, and rebuild after changing one.

## Deploying

1. Set the variables above in the Vercel project (Production and Preview).
2. Apply any new `supabase/migrations/*.sql` to the project, in order, before
   the deploy that needs them lands.
3. Push delivery. The database is the primary path: `pg_cron` writes rows
   nobody's server action flushes (the daily journal at the establishment's
   time, kiosk check-ins), and Postgres itself calls `/api/push/dispatch`
   over `pg_net` — `kg_kick_push_dispatch()` right after each daily-journal
   run, and `kg_dispatch_pending_push()` every 5 minutes for anything else
   (hourly backoff on rows a kick already failed to deliver). For that call
   to reach the app, tell the database where it lives, **by hand, in the SQL
   editor, once per deploy and again whenever the domain changes** — the URL
   and headers are never committed:

   ```sql
   update kg_push_config set dispatch_url = '<NEXT_PUBLIC_APP_URL>/api/push/dispatch';
   -- With Vercel Deployment Protection on, also pass the bypass token, or
   -- pg_net gets a silent 401 and only the backstops below deliver:
   update kg_push_config set dispatch_headers = '{"x-vercel-protection-bypass": "<token>"}';
   select kg_kick_push_dispatch();
   select status_code, content from net._http_response order by created desc limit 1;
   -- expect 200 and a body with "runs" and "native" keys
   ```

   The kick authenticates with the `kg_push_config.secret` row, which must
   equal `PUSH_DISPATCH_SECRET`. A wrong URL fails silently: the check query
   above is the only signal, so run it after every deploy. Read the body,
   not only the status: a 200 whose body lacks `runs` means an older build
   is still answering at that URL, and it would render digest rows with the
   generic daily-report text and the pre-day-page link — so no tenant may be
   shown the daily-journal switch until this check passes.

   Vercel Cron is the backstop, not the delivery path: `vercel.json`
   schedules `/api/push/dispatch` at 05:35 UTC (06:35 Algiers) and 16:20 UTC
   (17:20 Algiers, after most establishments' journal time), authenticated
   with the injected `CRON_SECRET` (Vercel-only; the database kick never
   uses it). Two daily runs is the Hobby-plan ceiling; the project's plan
   could not be confirmed from the repository at the time of writing, and a
   sub-daily schedule makes a Hobby deploy fail, so the daily pair was
   chosen. On a Pro project replace the 16:20 entry with `*/15 * * * *`
   (a quarter-hourly sweep) — nothing in the code depends on the schedule.
   Each call drains up to ten passes of 200 rows per transport under a
   60-second budget, so a backlog clears in one invocation.

   Invoice drafts and overdue refresh are `pg_cron` jobs inside Postgres — see
   `supabase/README.md`; the migration that adds the journal sender and the
   kick (`0152_kg_daily_journal.sql`) carries the same deploy step in its
   header.
4. Check `/` (landing), `/login`, and that a protected route redirects when
   signed out. A missing Supabase variable shows itself as one sentence naming
   the variable, not as a stack trace.

## The demo tenant

A fully populated crèche, **روضة الأمل (عرض تجريبي)** (`amal-demo`), lives in
the production database next to the real client, for sales demonstrations.
Everything about keeping the two apart — tenant ids, the `settings->>'demo'`
marker, the teardown script and its safety asserts — is in
[`scripts/demo/README.md`](scripts/demo/README.md). Its passwords are
deliberately not in this repository: this repo is public and those accounts are
real logins into the live database.

## House rules

The rules that are easy to get wrong are written down; read them before
touching the areas they cover.

- [`CONVENTIONS.md`](CONVENTIONS.md) — data access through `requireStaff()` /
  `getTenantContext()` and `.eq("tenant_id", …)` on every query; zod on every
  server action; `revalidatePath` after every write; the bidi rules for Arabic
  (ranges through `ValueRange`, `dir="ltr"` on phones and times, `dir="auto"`
  + `text-start` on anything a person typed).
- [`THEME.md`](THEME.md) — one palette of tokens in `globals.css`; no raw
  Tailwind palette colours anywhere. Tints take `-ink`, solids take
  `-foreground`.
- [`NOTIFICATIONS.md`](NOTIFICATIONS.md) — who is notified about what, how
  fan-out lives in database triggers, and how web push is dispatched.
- Digits are Western (1 2 3) in every language, never ١٢٣; phones are shown
  as `0770 22 01 01`.
- The week is per tenant: `kg_tenants.opening_hours` through
  `src/lib/week.ts` (`openDays`, `isOpenDayStr`, `countOpenDays`). Never
  hardcode Sunday–Thursday.
- "Today" is Algiers time (`Africa/Algiers`, UTC+1, no DST): use the
  `algiersToday` / `algiersMonth` helpers, never `new Date()` for a calendar
  date and never `toISOString().slice(0, 10)`.
- Staff names go through `fetchProfileNames` + `memberNameIn` in
  `src/lib/member-names.ts`, never a bare `kg_profiles` lookup — most staff
  have no account.
- Native `<input type="date|time">` is banned; use the pickers in
  `src/components/shared/`.
- Every `t()` key added must exist in `ar`, `en` **and** `fr`;
  `npm run check:messages` enforces it.

## Layout

```
messages/{ar,en,fr}/<namespace>.json   one file per module, per language
src/app/(auth)      login, signup, invite redemption
src/app/(dashboard) the crèche's back office (staff roles)
src/app/(portal)    the parent portal
src/app/(platform)  the operator panel (/admin)
src/app/kiosk       tablet check-in at the door
src/app/enroll      public enrolment form (per-tenant token)
src/components/modules/<module>/       components + actions.ts per module
src/lib             tenant context, formatting, week, notifications, env
supabase/migrations numbered schema, RLS, RPCs, triggers, cron
```
