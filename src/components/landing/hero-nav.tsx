"use client";

// Interactive parts of the landing header: the desktop grouped dropdowns and
// the mobile sheet. Kept in its own client module so `site-header.tsx` (and the
// async server `Wordmark` it renders) stay on the server.
//
// Everything here is driven by data the server passes in — no user-visible
// string is authored in this file.

import { useLocale } from "next-intl";
import {
  ArrowRightIcon,
  BabyIcon,
  BadgeCheckIcon,
  BlocksIcon,
  CheckCheckIcon,
  ChevronDownIcon,
  GraduationCapIcon,
  MenuIcon,
  MessagesSquareIcon,
  ReceiptTextIcon,
  UsersRoundIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { TILE, type TileTone } from "./styles";

export type NavMenuItem = { id: string; href: string; title: string; desc: string };

export type NavEntry =
  | { kind: "link"; id: string; href: string; label: string }
  | {
      kind: "menu";
      id: string;
      href: string;
      label: string;
      items: NavMenuItem[];
      footer: { href: string; label: string };
    };

export type HeaderLabels = {
  nav: string;
  menu: string;
  login: string;
  signup: string;
  /** Parents sign in through the same door; the label is what tells them so. */
  parents: string;
};

type Glyph = React.ComponentType<{ className?: string }>;

/** Icons live client-side and are looked up by id — components aren't serialisable. */
const ITEM_ICON: Record<string, Glyph> = {
  admissions: UsersRoundIcon,
  attendance: CheckCheckIcon,
  billing: ReceiptTextIcon,
  parents: MessagesSquareIcon,
  creche: BabyIcon,
  kindergarten: BlocksIcon,
  preschool: GraduationCapIcon,
  network: BadgeCheckIcon,
};

const ITEM_TONE: TileTone[] = ["sky", "mint", "amber", "pink"];

const NAV_LINK =
  "rounded-full px-3.5 py-2 text-sm font-semibold text-foreground/70 outline-none transition-colors hover:bg-primary/10 hover:text-primary focus-visible:ring-3 focus-visible:ring-ring/50";

const TRIGGER = cn(
  NAV_LINK,
  "group inline-flex items-center gap-1 data-[state=open]:bg-primary/10 data-[state=open]:text-primary"
);

function MenuTile({ id, index }: { id: string; index: number }) {
  const Icon = ITEM_ICON[id] ?? BlocksIcon;
  return (
    <span
      className={cn(
        "grid size-8 shrink-0 place-items-center rounded-lg",
        TILE[ITEM_TONE[index % ITEM_TONE.length]]
      )}
    >
      <Icon className="size-4" />
    </span>
  );
}

/* ── Desktop: centred nav with real Radix dropdowns on the grouping items ── */

export function HeaderNav({ entries, label }: { entries: NavEntry[]; label: string }) {
  return (
    <nav aria-label={label} className="hidden items-center gap-0.5 xl:flex">
      {entries.map((entry) =>
        entry.kind === "link" ? (
          <a key={entry.id} href={entry.href} className={NAV_LINK}>
            {entry.label}
          </a>
        ) : (
          <DropdownMenu key={entry.id}>
            <DropdownMenuTrigger className={TRIGGER}>
              {entry.label}
              <ChevronDownIcon
                aria-hidden
                className="size-3.5 transition-transform duration-200 group-data-[state=open]:rotate-180"
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="center" sideOffset={10} className="w-80 rounded-2xl p-1.5">
              {entry.items.map((item, i) => (
                <DropdownMenuItem key={item.id} asChild className="items-start gap-3 rounded-xl p-2">
                  <a href={item.href}>
                    <MenuTile id={item.id} index={i} />
                    <span className="min-w-0">
                      <span className="block text-[13px] font-semibold text-foreground">
                        {item.title}
                      </span>
                      <span className="mt-0.5 block text-[11px] leading-snug text-pretty text-muted-foreground">
                        {item.desc}
                      </span>
                    </span>
                  </a>
                </DropdownMenuItem>
              ))}

              <DropdownMenuSeparator className="mx-2 my-1.5" />

              <DropdownMenuItem asChild className="rounded-xl px-3 py-2 focus:bg-primary/10">
                <a href={entry.footer.href} className="justify-between gap-3">
                  <span className="text-[12px] font-bold text-primary">{entry.footer.label}</span>
                  <ArrowRightIcon className="size-3.5 shrink-0 text-primary rtl:rotate-180" aria-hidden />
                </a>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )
      )}
    </nav>
  );
}

/* ── Mobile: sheet that slides in from the trailing edge in either direction ── */

export function HeaderMobileNav({
  entries,
  labels,
  brand,
}: {
  entries: NavEntry[];
  labels: HeaderLabels;
  brand: React.ReactNode;
}) {
  const locale = useLocale();
  // The trigger sits on the trailing edge, so the sheet enters from the same side.
  const side = locale === "ar" ? "left" : "right";

  return (
    <Sheet>
      <SheetTrigger
        aria-label={labels.menu}
        className="grid size-10 shrink-0 place-items-center rounded-full text-foreground/70 outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 xl:hidden"
      >
        <MenuIcon className="size-5" aria-hidden />
      </SheetTrigger>

      <SheetContent side={side} className="gap-0 p-0">
        <SheetHeader className="border-b border-border p-5">
          <SheetTitle className="sr-only">{labels.menu}</SheetTitle>
          {brand}
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 py-5">
          {entries.map((entry) =>
            entry.kind === "link" ? (
              <SheetClose asChild key={entry.id}>
                <a
                  href={entry.href}
                  className="mb-1 flex items-center rounded-xl px-2.5 py-3 text-base font-semibold text-foreground transition-colors hover:bg-muted"
                >
                  {entry.label}
                </a>
              </SheetClose>
            ) : (
              <div key={entry.id} className="mb-5">
                <p className="px-2.5 text-[11px] font-bold text-muted-foreground ltr:tracking-wider ltr:uppercase">
                  {entry.label}
                </p>
                <ul className="mt-2 space-y-0.5">
                  {entry.items.map((item, i) => (
                    <li key={item.id}>
                      <SheetClose asChild>
                        <a
                          href={item.href}
                          className="flex items-start gap-3 rounded-xl p-2.5 transition-colors hover:bg-muted"
                        >
                          <MenuTile id={item.id} index={i} />
                          <span className="min-w-0">
                            <span className="block text-sm font-semibold text-foreground">
                              {item.title}
                            </span>
                            <span className="mt-0.5 block text-xs leading-snug text-pretty text-muted-foreground">
                              {item.desc}
                            </span>
                          </span>
                        </a>
                      </SheetClose>
                    </li>
                  ))}
                </ul>
              </div>
            )
          )}
        </div>

        <SheetFooter className="gap-2.5 border-t border-border p-4">
          <SheetClose asChild>
            <a
              href="/signup"
              className="inline-flex h-11 items-center justify-center rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground shadow-md shadow-primary/25 transition-colors hover:bg-primary/90"
            >
              {labels.signup}
            </a>
          </SheetClose>
          <SheetClose asChild>
            <a
              href="/login"
              className="inline-flex h-11 items-center justify-center rounded-full border border-border px-6 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
            >
              {labels.login}
            </a>
          </SheetClose>
          {/* Same destination as the login above — /login routes by role once
              you are in. Two labelled doors rather than one unlabelled one,
              because a parent reading "Connexion / Essai gratuit" on a page
              selling software to crèches has no reason to think it means them. */}
          <SheetClose asChild>
            <a
              href="/login"
              className="inline-flex h-11 items-center justify-center rounded-full px-6 text-sm font-semibold text-primary transition-colors hover:bg-primary/8"
            >
              {labels.parents}
            </a>
          </SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
