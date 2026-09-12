# Private-school rollout

The private-school types are `private_primary`, `private_middle`, and
`private_secondary`. A school offering several cycles selects several types;
the existing tenant-creation RPC creates one structure for each selected type.
No existing establishment is converted, and `edu_center` remains a tutoring /
educational-center type.

## Database activation

Applied and verified on the connected Rawdatik project on 2026-09-10:
`migrations/0146_kg_private_school_types.sql`.
The application never applies migrations. The migration adds enum values and
an authenticated, security-invoker metadata RPC. It does not change tenant
rows, memberships, RLS policies, or subscriptions.

After committing the migration, verify in the SQL editor:

```sql
select public.kg_available_center_types();
select
  has_function_privilege('authenticated', 'public.kg_available_center_types()', 'EXECUTE') as staff_can_check,
  has_function_privilege('anon', 'public.kg_available_center_types()', 'EXECUTE') as anonymous_can_check;
```

The array must contain all three school values. The privileges must be true
and false respectively. Reload onboarding after activation; the private-school
choices enable only when the authenticated capability check succeeds.

Do not test signup against a real owner's account without their intent to
create an establishment. Use an isolated test project/account to verify that
selecting two school cycles creates two structures and an owner membership.

## Current scope

- Onboarding and structure editing recognize each private-school cycle.
- Workspace shortcuts and navigation use the selected cycle and pupil labels.
- Classes, attendance, pupil records, calendar, and existing billing tools are reused.
- School types are not included in the app's kindergarten-register type list.
- Class subject programs, weekly lessons, tests/exams, marks and published family
  results are now implemented in `/learning`; see `LEARNING_WORKFLOWS.md`.
- Formal academic-year promotion, weighted term averages and official report cards
  are not implemented.

The school types identify product workspaces, not accreditation or a claim of
regulatory compliance. No official curriculum, examination schedule, or grading
rule is encoded in this change.

Enum migration reference:
https://supabase.com/docs/guides/database/postgres/enums
