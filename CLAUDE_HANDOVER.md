# Rawdatik handover to Claude

Updated: 2026-09-11. This document accompanies the local implementation commit.
No push or deployment was requested. Start by reading this document and AGENTS.md.

## Product intent

Build an end-to-end institution workspace for Algeria, with business-specific
onboarding, navigation, classes, staff, learners, programs, weekly sessions and
assessments. The user wants coherent UX, not accumulating standalone cards and
forms. Preserve the existing visual theme, Arabic RTL, French and English.
Use themed dropdowns, calendars and time pickers, not native browser popups.
Private schools are explicitly private_primary, private_middle and
private_secondary; do not present public-school institutions as the product's
customer types. Do not claim official Algerian curriculum or legal compliance.

## Environment and safety

- Intended checkout for continued work: `/Users/pc/Documents/K1`, branch `main`.
  Implementation commit `4342eae` was originally created in
  `/Users/pc/Documents/New project`, then transferred to K1 by a local fast-forward.
  K1's existing untracked `Rawdatik/` folder was left untouched. Nothing was pushed.
- Repository supplied by user: https://github.com/fonthenet/k1.
- Next.js 16.3.3, React 19.2.8, next-intl, Tailwind 4, Radix/shadcn, Supabase.
- Read relevant `node_modules/next/dist/docs/` before changing Next.js code.
- Dev preview: http://127.0.0.1:3000. Login endpoint last returned HTTP 200.
  The server was started from the original New project checkout, not K1. Verify
  its process working directory before continuing; transferring the commit did
  not restart or move the server.
- Supabase is configured. Never print or commit .env files, keys or auth tokens.
  A previously supplied env path was `/Users/pc/Documents/K1 Project/rawdatik/.env.local`;
  do not assume that older folder is the active checkout.
- Preserve real records and uncommitted user changes. Do not cancel, delete or
  move overlapping appointments automatically. No remote mutation is authorized
  merely by this handover. Use isolated fixtures for write-flow verification.

## Implemented

- Private-school capability detection and onboarding/structure choices, with one
  structure per selected type and business-specific workspace/navigation labels.
- Learning programs reuse existing classes, learners and assigned class teams.
  Program creation uses class selection, suggested templates, then review/dates.
- Weekly lessons support 1-16 atomic weekly occurrences in Algeria local time,
  completion/cancellation, class/staff checks, opening hours and closures.
- Assessments support academic tests/exams or developmental observations,
  learner results, publish/unpublish and read-only parent access.
- Calendar, class, dashboard and parent pages link to learning workflows.
- Shared themed form selects and calendar month/year dropdowns. Calendar header
  navigation no longer overlays and intercepts month/year clicks.
- Auth success uses a full-page navigation to avoid a stuck post-login state.
- Latest scheduler revision replaces the permanent session card with an
  Add session dialog on each timetable day. It keeps day/class context, limits
  staff to the class team, prefills program title/type, uses themed date/time
  controls, shows field errors and previews every repeated date before saving.
- Server actions reject archived programs and whole repeat series outside the
  program date range. Errors distinguish dates, staff, closures and conflicts.

## Code map

- `src/app/(dashboard)/learning/page.tsx`: weekly view, tabs and editor integration.
- `src/components/modules/learning/session-editor.tsx`: new session dialog.
- `src/components/modules/learning/forms.tsx`: program wizard and assessments.
- `src/components/modules/learning/actions.ts`: authorized server mutations.
- `src/components/modules/learning/domain.ts`: schemas, profiles, dates/recurrence.
- `src/components/modules/learning/data.ts`: queries and accessible learning data.
- `src/components/modules/learning/program-templates.ts`: suggested content.
- `src/app/(dashboard)/learning/assessments/[id]/page.tsx`: results workflow.
- `src/app/(portal)/portal/learning/page.tsx`: family learning view.
- `src/components/modules/settings/workspace-profile.ts`: type-aware workspaces.
- `src/components/shared/{form-select,date-picker,time-picker}.tsx`: themed fields.
- `src/components/ui/calendar.tsx`: shared calendar including month/year controls.
- `messages/{ar,en,fr}/{learning,scheduler}.json`: translations, registered in
  `src/i18n/request.ts`.
- `supabase/LEARNING_WORKFLOWS.md` and `supabase/PRIVATE_SCHOOLS.md`: scope/history.

## Critical database blocker

These migrations were previously reported applied to the connected project:

- `0146_kg_private_school_types.sql`
- `0147_kg_learning_workflows.sql`
- `0148_kg_learning_history.sql`
- `0149_kg_learning_class_index.sql`

`0150_kg_scheduler_hardening.sql` was applied on 2026-09-11 (ledger 20260911193640) after staggering the 24 demo overlaps; the paragraph below is history.
Read-only preflight found 24 overlapping existing appointment pairs: 18 scheduled
and 6 completed. These are pairs, not necessarily 48 distinct appointments.
No remote records were changed to resolve them.

The pending migration adds a private derived occupancy ledger with a GiST
exclusion constraint shared by class lessons and individual therapy sessions.
It also closes validation bypasses through cancelled/completed/scheduled status
changes and program reassignment. Source RLS remains authoritative, cancellation
releases occupancy, historical records remain intact. Migration preflight runs
under write locks and aborts atomically if existing overlaps are present.

Next: run `supabase/tests/scheduler_preflight.sql` read-only, present conflicts to
the owner, agree how each should be handled, and only then apply/verify. Never
blindly run all pending migrations. Until applied, cross-module double-booking
protection and those trigger fixes are NOT live, despite the new frontend checks.
The live server is PostgreSQL 17; local migration tests used PostgreSQL 14.

## Verification and honest limits

Passed in the previous implementation turn:

```sh
npx tsc --noEmit
npm run check:messages
npm run build -- --webpack
/opt/homebrew/bin/node --test scripts/learning.test.mjs scripts/workspace-profile.test.mjs
git diff --check
```

The test command passed 17 tests. Node at `/opt/homebrew/bin/node` was version 25
and supports TypeScript stripping; default Node 20 is insufficient for that test
setup and emits a Supabase deprecation warning during builds. Scoped ESLint
passed for the changed learning components/actions/page. No full-repo lint pass
is claimed. Build passed before the final small selected-label rendering change;
TypeScript, scoped lint and the 17 tests were rerun after that change.

Browser checks on the integrated editor covered required-staff focus, themed
time/calendar/month menus, repeat preview, out-of-range repeats, and closing while
retaining edits. No real bookings were created in this revision. Separate earlier
workflow checks are recorded in LEARNING_WORKFLOWS.md, not a substitute for testing
the new editor's full save flow.

A synthetic browser test passed date/staff resets on program switch but failed
an immediate assertion for the new session-type label. The cause was not proven.
The label now renders explicitly from the selected option instead of relying on
Radix item-label registration. Cross-business switching and successful/failed
save flows still need a reproducible browser regression test. Do not report them
as verified. Mobile EN/FR/AR mock checks were reported by the frontend reviewer;
integrated mobile save flows remain unverified.

Backend reviewer reported local passes for lifecycle/permissions, bidirectional
conflicts, migration atomic failure/history preservation, existing learning tests
and eight two-connection races (both directions, READ COMMITTED/REPEATABLE READ,
winner commit/rollback). See `supabase/tests/scheduler_*.sql`. The local harness
and concurrency script are for a disposable local database ONLY; they create
fixtures and emulate parts of Supabase auth, not the full production integration.

## Recommended next work

1. Complete isolated browser-to-action-to-database save tests across business
   types, EN/FR/AR, desktop/mobile, program switching, duplicate submits, server
   failure, staff changes, closures and recurrence boundaries.
2. Resolve the live overlap blocker with owner decisions and verify the migration
   against PostgreSQL 17 before claiming end-to-end conflict protection.
3. Design series identity and explicit edit-one/edit-future/edit-series behavior.
   Current occurrences are independent rows; cancel-and-replace is the existing
   way to move a session. Series-wide rescheduling is not implemented.
4. Continue a coherent timetable UX review rather than adding more permanent
   forms. Review calendar required-field handling outside the new session editor;
   shared DatePicker required is not native blocking validation on its own.

Not delivered: complete school ERP, official curriculum, academic-year promotion,
weighted term averages/report cards, exam question banks/online tests, room-level
conflicts, or native mobile parity. Individual therapy plans and paid activity
subscriptions/billing remain separate from class learning programs.
