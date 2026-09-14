# Demo tenant — روضة الأمل (عرض تجريبي)

A fully populated crèche in Hydra, Algiers, for sales demonstrations. It lives
in the **production** database alongside the real client, so everything here is
about keeping the two apart.

| | |
|---|---|
| tenant | `732bdf7d-775a-4ed7-875f-8c04ea4e4778` |
| slug | `amal-demo` |
| marker | `kg_tenants.settings->>'demo' = 'true'` |
| real client — never touch | `fb050631-e62f-43f1-9e12-933e564974e8` |

## Logins

The password is **deliberately not in this repository** — github.com/fonthenet/k1
is public, and these accounts are real logins into the production database.
An authenticated stranger inside the demo tenant is a stranger inside the same
Postgres as the live crèche, with RLS as the only boundary. Ask the owner, or
reset it:

```sql
update auth.users
   set encrypted_password = crypt('<new password>', gen_salt('bf'))
 where email like '%@rawdatik.com';
```

| role | login | who |
|---|---|---|
| owner / director | `directrice@rawdatik.com` | أمينة قروي |
| accountant | `comptable@rawdatik.com` | سعاد بن عمار |
| educator | `educatrice@rawdatik.com` | ليلى مرابط |
| parent (2 children) | `parent1@rawdatik.com` | سفيان عمراني |
| parent | `parent2@rawdatik.com` | عادل شعباني |
| parent | `parent3@rawdatik.com` | هشام سليماني |

Verified end to end against the auth API — all six obtain a token, and each
sees exactly what it should through RLS:

| account | children | invoices |
|---|---|---|
| directrice | 33 | 231 |
| comptable | 33 | 231 |
| educatrice | 33 | **0** — money is hidden from an educator |
| parent1 | 2 | 14 |
| parent2 / parent3 | 1 | 7 |

NOTE for anyone creating more demo accounts by hand: `auth.users` has several
token columns (`confirmation_token`, `recovery_token`, `email_change`,
`email_change_token_new`, …) that GoTrue reads into a Go `string`. Leaving them
NULL makes every sign-in fail with "Database error querying schema" — they must
be `''`. This is why the Auth Admin API is the supported route.

Six accounts, no more, on purpose: every additional auth user also becomes a row
in the OTHER product's `public.profiles` via the `on_auth_user_created` trigger
on `auth.users`. The other 6 staff and 63 guardians have no login at all.

## Rules for whoever demos it

- Never enable notifications in the browser. `kg_push_subscriptions` and
  `kg_push_devices` are empty and must stay that way — the demo generated 331
  notifications, all stamped `pushed_at` so nothing can ever be delivered.
- Never open the support bubble: `kg_support_threads` is the one genuinely
  cross-tenant surface in the product.
- Never submit the landing-page quiz from the demo browser; it writes a lead.

## Daily journal of 2026-09-10

`daily_journal_seed.sql` shows a day the automatic *Journal du jour* went out.
Run it once in the SQL editor after migration 0152 is applied (it refuses to
run before): for the children of the four crèche classes it writes the
attendance of Thursday 2026-09-10 (present 08:06–16:30, two absent), a
published journal each (lunch, 13:00–14:00 nap, mood, one note), the photos
consent for Adam Amrani, one `kg_daily_journal_ledger` row per child decided
at 17:03 (`sent` for the four families with a login, `skipped_no_account` and
`skipped_absent` for the others) and one digest notification per guardian
account, composed by the same functions as the sender and stamped `pushed_at`
so nothing can be delivered. It is idempotent and scoped to the demo tenant in
every statement; the commented block at its bottom removes exactly what it
wrote. `supabase/tests/daily_journal_rehearsal.sql` runs it and its teardown
inside a rolled-back transaction.

## Calendar

`calendar_seed.sql` gives the calendar of September–October 2026 something to
show on every surface: four events (an all-day outing of 1re année on the 23rd,
the Petite Section parents' meeting on the 22nd with RSVP, the école open day
on 1 Oct, a staff meeting on the 28th), a two-day closure of the école only
(27–28 Sept), an exam and an observation, two therapy sessions (Zakaria on the
21st; Adam on the 23rd, unpublished, which is how a family sees an appointment
before its outcome), two tasks, one pending leave (نادية, 1 Oct), the interview
of سلمى on the 21st, and the October cours (the week of 20–24 Sept cloned to
4–8 Oct, since the seeded timetable stops on the 24th). Every row carries the
id prefix `a5f0b4c2-9d3e-4c1f-8b7a-0157`.

Run it once in the SQL editor **after migrations 0157–0159** (it refuses to
run before): first with its last line changed to `rollback;`, reading the two
sanity blocks it prints (expected counts 4, 1, 2, 2, 2, 1, 17, 1; every
notification row `unpushed = 0`), then with `commit;`. The triggers write real
notification rows for the accounts concerned — parent1 for the meeting and
Adam's appointment, the staff for the closure and their meeting — and the seed
stamps them `pushed_at` before anything can be delivered. The optional step I
(commented) links parent3 to Amira Saadi for the école-family screenshots.

`calendar_teardown.sql` removes exactly those rows and the notification rows
the triggers wrote for them (the source rows first, so the delete triggers
speak inside the same transaction and are swept too), unlinks parent3 if step
I was run, and puts سلمى's application back to `under_review`. Its three
closing counts must read 0. Rehearse it with `rollback;` first as well.

`supabase/tests/calendar_rls.sql` and `supabase/tests/calendar_lifecycle.sql`
are the rehearsal blocks of 0158, 0159 and 0161 as standalone, rolled-back tests
against the demo tenant; run them after every later migration.

## Teardown

`teardown.sql` removes every row. It is scoped by tenant id in every statement
and asserts the real client is untouched before it commits.
