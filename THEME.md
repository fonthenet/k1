# Rawdati Theme — "Algiers" (emerald + gold)

ONE palette, defined once in `src/app/globals.css`. Every surface consumes tokens.
**Never hardcode a Tailwind palette colour** (`bg-indigo-600`, `text-amber-500`, `from-violet-500`…).
If you need a colour that isn't below, ask the lead — don't invent one.

## Tokens → use these

| Purpose | Class | Notes |
|---|---|---|
| Page background | `bg-background` | barely-green white |
| Body text | `text-foreground` | |
| Secondary text | `text-muted-foreground` | |
| Panels/cards | `bg-card` + `border-border` | |
| Brand / primary action | `bg-primary text-primary-foreground` | emerald |
| Primary tint (chips, active nav, avatars) | `bg-primary/10 text-primary` | |
| Secondary surface | `bg-secondary text-secondary-foreground` | |
| Muted surface | `bg-muted text-muted-foreground` | |
| **Gold accent** (highlights, pinned, "populaire", stars) | `bg-gold text-gold-foreground`, tint `bg-gold-muted text-gold`| the counterweight to the green |
| Success / present / paid / income | `text-success`, `bg-success/10` | |
| Warning / pending / tentative | `text-warning`, `bg-warning/10` | |
| Danger / allergy / overdue / expense | `text-destructive`, `bg-destructive/10` | |
| Money in | `text-income` | Money out: `text-expense` |
| Sidebar | `bg-sidebar text-sidebar-foreground`, active `bg-sidebar-accent text-sidebar-accent-foreground` | |
| Focus ring | `ring-ring` | |
| Charts (recharts) | `var(--chart-1)` … `var(--chart-5)` | income `var(--income)`, expense `var(--expense)` |
| Brand gradient | `bg-gradient-to-br from-brand-from via-brand-via to-brand-to` | landing hero, auth panel, logo marks |

## Mapping from what's in the code now

| Old (delete it) | New |
|---|---|
| `indigo-*`, `violet-*`, `fuchsia-*`, `purple-*` (brand/gradients) | `primary` / brand gradient tokens |
| `amber-*`, `yellow-*` used as *accent/highlight* | `gold` / `gold-muted` |
| `amber-*` used as *warning* | `warning` |
| `emerald-*`, `green-*` (success/present/paid) | `success` (or `income` for money) |
| `red-*`, `rose-*` (allergy/overdue/expense) | `destructive` (or `expense` for money) |
| `sky-*`, `blue-*`, `cyan-*` (info/chart only) | `chart-4`, or `primary` if it was decorative |
| `slate-*`, `gray-*`, `zinc-*`, `neutral-*`, `stone-*` | `foreground` / `muted-foreground` / `border` / `muted` |
| warm cream portal bg (`amber-50`, `orange-50`, `#FFF…`) | `bg-background` (the palette is already warm-friendly) |

## Rules
- Opacity tints are fine and encouraged: `bg-primary/10`, `border-primary/20`, `bg-destructive/10`.
- Dark mode is real now (`next-themes`, `.dark` class). Because you use tokens, dark works for free — do **not** add `dark:` overrides for colours that are already tokens.
- Keep RTL-safe logical utilities (`ps-/pe-/ms-/me-/text-start`).
- Allergy badges stay `destructive` — safety signal, must remain red.
- Don't touch `src/app/globals.css` (lead-owned).
