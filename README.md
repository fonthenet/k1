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
| `CRON_SECRET` | Vercel injects it; do not set locally | `/api/push/dispatch` |

`NEXT_PUBLIC_*` values are inlined into the browser bundle at build time: never
put a secret in one, and rebuild after changing one.

## Deploying

1. Set the variables above in the Vercel project (Production and Preview).
2. Apply any new `supabase/migrations/*.sql` to the project, in order, before
   the deploy that needs them lands.
3. `vercel.json` schedules `/api/push/dispatch` daily at 05:35 UTC (06:35
   Algiers) via Vercel Cron, authenticated with the injected `CRON_SECRET`.
   Invoice drafts and overdue refresh are `pg_cron` jobs inside Postgres — see
   `supabase/README.md`.
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
