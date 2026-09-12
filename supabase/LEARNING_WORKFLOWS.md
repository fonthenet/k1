# Learning workflows

## Implemented

- Signup retains each selected business type as a separate structure. The existing
  role-aware dashboard now includes a live setup checklist and profile priorities.
- Reuses existing classes, enrolled children, staff memberships and class teams.
  No duplicate student directory, fake classes, accounts or fees are seeded.
- `/learning` creates class programs with subject/title, objectives and date range.
  Programs can be archived and restored. Program dates/class identity are immutable
  to preserve scheduled history; use a new program for a new period.
- Weekly sessions: assigned active class staff, 1-16 atomic weekly occurrences,
  Algeria local time, Sunday-first seven-day view, per-structure hours/closures,
  database-enforced class/staff overlap prevention, completion and cancellation.
  Cancel and replace a session to move its time. Existing cancelled records remain.
- `/calendar` links the real scheduled lessons; each class links to its filtered plan.
- Nursery uses care routines and observations; kindergarten/Montessori use learning
  activities and observations; activity centers/camps use workshops. Therapy keeps
  individual clinical records in the existing Sessions module, separate from group plans.
- Private primary/middle/secondary and tutoring centers can create tests/exams with
  configurable maximum marks. Other business types cannot create exams even via API.
- Assessment roster: saved marks (including zero), absence without a fake zero,
  developmental outcomes, per-learner feedback, publish/unpublish. Published results
  are locked until unpublished. Missing results are not silently assigned marks.
- Parent home and child records link `/portal/learning`: only their children's plans
  and published results; historical results survive a class transfer.
- Arabic RTL, French and English translations; desktop and responsive layouts.

## Permissions and data

The three learning migrations were applied to the connected Rawdatik project on
2026-09-10. All four new tables have explicit grants and RLS. No anonymous access.
Only admins or the assigned class teaching team can write. Tenant/class/program
foreign keys are composite. Student and assessment ownership are immutable.
Parents never gain write access to teaching records. A narrow boolean helper in
the non-exposed `kg_learning_private` schema handles historical guardian ownership
without recursive RLS; it checks the current authenticated identity and membership.

## Verification

### Scheduler revision (2026-09-11)

- Each timetable day opens a session dialog instead of an always-visible form.
  It retains day/class context, uses themed date/time controls, validates staff
  and program dates, and previews all weekly occurrences before submission.
- Server actions also reject archived programs and repeats outside program dates.
- TypeScript, scoped lint, translation parity, 17 domain/profile tests and the
  webpack production build passed. Browser checks covered required staff, nested
  calendar/month/time menus and repeat-range errors without saving user bookings.
  A synthetic program-switch label check was inconclusive; labels now render
  directly from the selected option. The revised cross-type/save flow still needs
  a browser regression in an isolated project.
- `0150_kg_scheduler_hardening.sql` was applied to the connected project on
  2026-09-11 (ledger version 20260911193640) after the 24 overlapping pairs —
  all demo-tenant therapy sessions, 8 days × 3 children in one slot — were
  staggered explicitly (+45 / +90 min, no session cancelled or deleted). It was
  first rehearsed in a rolled-back transaction on PostgreSQL 17.6: 79 ledger
  rows, cross-module and same-slot overlaps refused (`exclusion_violation`),
  cancellation releases the slot. Cross-module double-booking protection is live.
- Local PostgreSQL 14 tests had passed lifecycle, atomicity, preservation and
  eight two-connection races; the concurrency harness SQL is for a disposable
  local database only.
- Series-wide editing/rescheduling is not implemented; occurrences remain
  independent records. Do not treat this revision as a complete scheduler release.

- `node --test scripts/learning.test.mjs scripts/workspace-profile.test.mjs`
  requires a Node version supporting TypeScript stripping (tested with Node 25).
- `supabase/tests/learning_workflows.sql` runs isolated fixtures inside a rollback.
  Requires three existing auth identities, but does not modify their real records.
  Checks tenant FK protection, schedules, closed days, staff assignment, school-only
  exams, marks, parent drafts/publication/isolation and class-transfer history.
- TypeScript, scoped ESLint, message parity, webpack production build.
- `supabase/tests/business_signup.sql` verifies all ten business-type bootstraps
  and a three-cycle private school through the real tenant-creation RPC; all rolled back.
- Browser verified program creation, two-week scheduling, observation creation and
  the linked real class roster. QA rows were removed; no learner results were invented.
  Validation errors preserve the form. Arabic desktop and 390px mobile checked.
- Existing security-advisor issues in legacy tables/functions are not changed by
  this feature. New learning objects have no security-advisor findings.

## Not a complete school ERP release

No official Algerian curriculum, accreditation or statutory compliance is claimed.
Programs are configured by the institution. Formal academic years, automatic class
promotion, weighted term averages, official report-card exports, exam question banks,
online test taking, room-level booking conflicts and the separate native mobile app
are not implemented in this change. Existing activity subscriptions/billing and
individual therapy plans remain separate from class lessons. A scheduled class
activity does not enroll/bill a learner in a paid extracurricular activity.

Before production rollout, exercise fresh-owner signup and real invitations in an
isolated project, and run full regressions on admissions/billing and native clients.
