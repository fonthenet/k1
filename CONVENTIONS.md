# Rawdati — Engineering Conventions (READ FIRST)

Multi-tenant kindergarten management SaaS for Algeria. Next.js 15 App Router + TypeScript + Tailwind v4 + shadcn/ui (Radix, RTL-enabled) + Supabase (auth, Postgres with RLS, storage). French-first UI with full Arabic RTL.

## Non-negotiables

1. **Never edit shared/foundation files.** These are owned by the lead: `src/app/layout.tsx`, `src/app/(dashboard)/layout.tsx`, `src/middleware.ts`, `src/lib/**`, `src/components/shell/**`, `src/components/ui/**`, `src/i18n/**`, `next.config.ts`, `package.json`, `src/app/globals.css`, `messages/{fr,ar}/common.json`. If you need a dependency that isn't installed or a change to a shared file, note it in your final report instead of making it.
2. **Own only your assigned directories** (routes, components, messages namespaces). Do not create files outside them.
3. **Schema is law.** The database schema is in `supabase/migrations/*.sql` — read it before writing queries. All tables are prefixed `kg_`. RLS is enforced; queries run as the signed-in user.

## Data access

- Server components / server actions: `const supabase = await createClient()` from `@/lib/supabase/server`.
- Client components (rare — only for interactivity like kiosk): `createClient()` from `@/lib/supabase/client`.
- Tenant + role context in every dashboard page:
  ```ts
  import { requireStaff, requireAdmin, requireFinance, getTenantContext } from "@/lib/tenant";
  const ctx = await requireStaff(); // { user, tenant, membership, role, isAdmin, isFinance, isStaff }
  ```
  Always filter queries with `.eq("tenant_id", ctx.tenant.id)`.
- Parent portal pages use `getTenantContext()` (role may be `parent`).
- Mutations: Next server actions (`"use server"`) colocated in an `actions.ts` inside your module dir. Validate inputs with `zod`. After writes call `revalidatePath`.
- RPCs (call with `supabase.rpc(name, args)`): `kg_create_tenant`, `kg_get_enroll_link`, `kg_submit_application`, `kg_approve_application`, `kg_checkin_by_tag`, `kg_staff_clock`, `kg_staff_clock_by_code`, `kg_ack_incident`, `kg_accept_staff_invite`, `kg_generate_monthly_invoices`, `kg_dashboard_stats` — signatures in `supabase/migrations/0004_kg_rpcs.sql`.
- Storage: bucket `kg-media` (private). Upload paths: `u/{userId}/...` (user-owned) or `t/{tenantId}/children/{childId}/...` (child media). Display via `signedMediaUrl(path)` from `@/lib/tenant` (server) or `supabase.storage.from("kg-media").createSignedUrl(path, 3600)` (client).

## Domain types & helpers

- Types: `@/lib/types` (Child, Guardian, Invoice, …). Use them; don't redeclare.
- Formatting: `@/lib/format` → `formatDZD(amount, locale)`, `formatDate`, `formatTime`, `ageFromDob`, `childDisplayName(child, locale)` (Arabic names in AR locale), `initials`, `isDzWeekend`. Currency is ALWAYS DZD via `formatDZD` — never hardcode "€" or "$".
- Week runs **Sunday–Thursday** (Friday+Saturday weekend). Use `isDzWeekend`; never assume Mon–Fri.

## i18n (mandatory)

- Language priority (user decision): **Arabic 1st (default locale), English 2nd, French 3rd** — all three fully supported.
- Every user-visible string goes through next-intl. Each module owns namespace files: `messages/ar/<ns>.json`, `messages/en/<ns>.json`, AND `messages/fr/<ns>.json` (all required; real Algeria-appropriate Arabic, not machine-garbled).
- Server components: `const t = await getTranslations("<ns>")` from `next-intl/server`. Client: `useTranslations("<ns>")`. Locale: `getLocale()` / `useLocale()`.
- Shared strings (Save, Cancel, statuses…) already exist in the `common` namespace — reuse `t("actions.save")` etc. via `getTranslations("common")`.
- RTL: layout flips automatically (`dir=rtl` for AR). Use logical Tailwind utilities (`ps-*`, `pe-*`, `ms-*`, `me-*`, `start-*`, `end-*`, `text-start`) — never `pl-/pr-/ml-/mr-/left-/right-` unless truly directional.

## UI standards

- shadcn/ui components from `@/components/ui/*` (button, card, table, dialog, select, tabs, badge, avatar, sheet, sonner toast, etc.). Icons: `lucide-react`.
- Shared: `PageHeader`, `StatCard`, `EmptyState` from `@/components/shared/*`.
- Page skeleton: `<PageHeader title description>{actions}</PageHeader>` then content. Wrap tables in `Card`. Loading states via `loading.tsx` with `Skeleton`.
- Forms: controlled React state + zod validation in the server action; toast feedback via `sonner` (`toast.success(...)`). Keep forms simple; no react-hook-form (not installed).
- Money/amounts right-aligned (`text-end tabular-nums`). Status → `Badge` with tone colors.
- Charts: `recharts` only, inside client components. Palette: use CSS chart tokens `var(--chart-1)`…`var(--chart-5)`; income green `#22c55e`, expense red `#ef4444`.
- Allergy safety rule: wherever a child appears in a roster/check-in/meal context, show a red allergy badge if they have allergies (query `kg_child_allergies`).
- Mobile-first for parent/enroll/kiosk surfaces; dashboard is desktop-first but must not break on mobile.

## Quality bar

- TypeScript strict — no `any` unless unavoidable, no `@ts-ignore`.
- Handle empty states, loading states, and error states on every page.
- Demo data exists (tenant "Les Petits Génies de Jijel") — your pages should render real data immediately.
- `npm run build` must pass. Do not leave unused imports.

## Bidi: ranges and mixed-direction text (Arabic is the default locale)

Logical utilities are not enough. Two LTR/neutral runs either side of a neutral
separator get REORDERED by an RTL paragraph:

    {formatTime(a)} {" → "} {formatTime(b)}   →  renders as  17:04 → 09:15

That is not cosmetic — it inverts the meaning (a child arriving at 17:04 and
leaving at 09:15). Rules:

- Any range of two times or dates goes through `<ValueRange from to />`
  (`@/components/shared/value-range`). It wraps the pair in `dir="ltr"`, which
  HTML5 treats as a bidi isolate.
- Use `separator="–"` for date spans; an arrow implies a direction of flow a
  date range does not have.
- Anything inherently left-to-right — phone numbers, tag codes, PINs, emails,
  invoice numbers, times — carries `dir="ltr"`. The codebase already does this
  in 100+ places; follow it.
- Numbers that open a translated Arabic string need a leading U+200F, and Arabic
  thousands separators should be U+00A0 so the digits cannot reorder.
- Test in Arabic FIRST, not last. An RTL bug in a fee, a time or a phone number
  is a correctness bug, not a layout nit.

## Colour: tints take "ink", solids take "foreground"

`--gold` and `--warning` are light hues. `text-gold-foreground` is near-white:
it is legible on solid `bg-gold` and invisible on the `bg-gold-muted` tint
(1.8:1). The pairing that reads is:

- solid fill  → `bg-gold text-gold-foreground`
- tint / muted → `bg-gold-muted text-gold-ink`   (5.4:1)

The rule is written at the top of the palette block in `globals.css`; it has
still been got wrong three times, so check it whenever you put text on a tint.
Measure rather than eyeball — `getComputedStyle` plus a canvas gives the real
ratio, and the target is 4.5:1 for body-size text.
