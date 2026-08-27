# Database

Supabase project: `qekibejzwpphzzyqigzo` (shared with a legacy prototype — all platform objects are prefixed `kg_`).

- `migrations/0001` core schema (tenancy, children, families, enrollment, activities, attendance, timesheets, billing, accounting, payroll, communication)
- `migrations/0002` research-driven additions (dual-script names, incidents, consents, compliance docs, leave, menus, holidays, receipt/invoice numbering)
- `migrations/0003` RLS helpers + full policy matrix (owner/admin, accountant=finance-only, educator/staff=operations, parent=own children only)
- `migrations/0004` business RPCs (tenant creation, enrollment pipeline, tag check-in, staff clock, invoice generation, dashboard stats, payment→ledger trigger)
- `migrations/0005` private `kg-media` storage bucket + path-based policies (`u/{userId}/…`, `t/{tenantId}/children/{childId}/…`)
- `migrations/0006` function hardening (pinned search_path, anon execution revoked)

> **Demo credentials are deliberately NOT in this repository.** This repo is
> public. The seeded demo tenant (**Les Petits Génies de Jijel**) has working
> logins, kiosk PINs, guardian PINs, child tag codes and a public enrolment
> token — all of them against a live Supabase project whose ref is visible in
> `next.config.ts`. Publishing them would hand anyone a session in the demo
> tenant, so they live outside version control.

Demo accounts, kiosk codes and the enrolment token are kept in the team's
password manager / `.env.local` notes, not here. Ask the maintainer.

Standing rule: **before this database holds a real crèche's records**, delete
the demo tenant outright, or rotate every demo credential. A shared demo tenant
and real children's data must never coexist in the same project.

The demo tenant's shape, which is safe to document:

| Account role | What it exercises |
|---|---|
| Owner / director | Full crèche administration. A crèche account only — deliberately NOT a platform operator |
| Educator | Operations: attendance, daily reports, incidents |
| Accountant | Finance-only — invoices, payments, ledger; no child records |
| Staff | Kiosk clock-in, tasks, menus |
| Parent ×2 | Portal: their own children only, across two families |

## Platform operator

`kg_platform_admins` (migration 0043) is the role that sits outside every
crèche: leads from the landing-page quiz, the tenant list, suspend/re-activate.
It grants **nothing** on the tenant tables — no RLS policy references it — so an
operator sees counts, never a child's record.

Adding one is a deliberate act at the database, because nothing in the app is
allowed to write that table:

```sql
-- takes effect the moment this address signs up
insert into kg_platform_admin_invites (email, note) values ('them@example.com', 'ops');
```

Pending: `f.onthenet@gmail.com` (founder) — sign up with that address and the
invite redeems itself on first login.

**No demo account is ever a platform operator.** Running a crèche and running
the platform are incompatible roles, and the demo login is shared and weakly
protected. If `/admin` is unreachable, that is the correct state until a real
operator account exists.

## Scheduled jobs

`pg_cron` (migration 0048). Algeria is UTC+1 year-round, so UTC expressions map
to a fixed local time.

| Job | UTC | Algiers | What it does |
|---|---|---|---|
| `kg-monthly-invoice-drafts` | `0 5 1 * *` | 06:00 on the 1st | Monthly invoice **drafts** for every active tenant. A human still issues them. |
| `kg-refresh-overdue` | `30 5 * * *` | 06:30 daily | Recomputes overdue status and sends the finance digest (deduped per tenant per day). |

```sql
select jobname, schedule, active from cron.job;                 -- what is scheduled
select * from cron.job_run_details order by start_time desc;    -- what actually ran
```

**Not scheduled:** push dispatch. It must POST to the app's `/api/push` route,
which needs `pg_net` and a deployed domain — cron cannot reach localhost. Until
then pushes go out only when a server action flushes the queue.
