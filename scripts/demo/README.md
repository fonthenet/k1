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

## Teardown

`teardown.sql` removes every row. It is scoped by tenant id in every statement
and asserts the real client is untouched before it commits.
