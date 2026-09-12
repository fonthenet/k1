"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Building2, Check, ChevronsUpDown } from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { setActiveStructure } from "@/app/actions/structure";
import { centerTypeLabel } from "@/components/modules/settings/center-types";
import { StructureTile } from "@/components/shared/structure-mark";
import { structureName, type Structure } from "@/components/modules/classes/class-types";
import { cn } from "@/lib/utils";

/**
 * Which structure of the building you are looking through.
 *
 * Renders NOTHING for a building with one structure, which is almost every
 * crèche — the whole feature has to be invisible until a director actually
 * runs a crèche and an école side by side, or it is one more control in the
 * way of the ninety-nine percent.
 *
 * The choice is a view, not a permission, and the wording works to say so:
 * "Tout l'établissement" leads, and the structures are what you narrow TO.
 * A control that read like an account switcher would suggest the school's
 * children are somewhere the director cannot reach.
 *
 * This is the ONE place the scope is said. Trigger and rows are the standalone
 * structure tile the settings page draws, with the structure's type as the
 * caption — the caption used to read "Structure affichée", which told you
 * nothing the tinted tile had not already told you.
 */
export function StructureSwitcher({
  structures,
  activeId,
  className,
}: {
  structures: Structure[];
  activeId: string | null;
  className?: string;
}) {
  const t = useTranslations("common.structures");
  const ts = useTranslations("settings");
  const locale = useLocale();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  if (structures.length < 2) return null;

  const active = structures.find((s) => s.id === activeId) ?? null;
  const tileOf = (s: Structure) => ({
    name: structureName(s, locale),
    color: s.color,
    center_type: s.center_type,
  });

  function choose(id: string | null) {
    setOpen(false);
    startTransition(() => {
      void setActiveStructure(id);
    });
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        className={cn(
          "flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-start transition",
          "ring-1 ring-sidebar-border/70 hover:bg-sidebar-accent/60",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
          pending && "opacity-60",
          className
        )}
        aria-label={t("switch")}
      >
        {/* The structure's own colour is the one signal here: a director who
            has scoped to the école should be able to tell at a glance, from
            anywhere in the app, without reading the label. On "the whole
            building" there is nothing to signal, so the tile goes grey rather
            than picking a structure's colour arbitrarily. */}
        {active ? (
          <StructureTile
            structure={tileOf(active)}
            caption={centerTypeLabel(active.center_type, ts)}
            className="min-w-0 flex-1"
          />
        ) : (
          <WholeBuildingTile label={t("all")} caption={t("allHint", { count: structures.length })} />
        )}
        <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>

      {/* Same width as the trigger, so the menu reads as the trigger unfolding
          rather than a second control appearing beside it. */}
      <DropdownMenuContent align="start" className="w-(--radix-dropdown-menu-trigger-width)">
        <DropdownMenuItem onSelect={() => choose(null)} className="gap-2 py-1.5">
          <WholeBuildingTile label={t("all")} caption={t("allHint", { count: structures.length })} />
          {!active && <Check className="size-4 shrink-0 text-primary" />}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {structures.map((s) => (
          <DropdownMenuItem key={s.id} onSelect={() => choose(s.id)} className="gap-2 py-1.5">
            <StructureTile
              structure={tileOf(s)}
              caption={centerTypeLabel(s.center_type, ts)}
              className="min-w-0 flex-1"
            />
            {active?.id === s.id && <Check className="size-4 shrink-0 text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The whole building, drawn with the anatomy of a StructureTile but without a
 * structure: a grey tile and the building glyph. It is not a structure, so it
 * has no colour and no type; the caption counts what it contains.
 */
function WholeBuildingTile({ label, caption }: { label: string; caption: string }) {
  return (
    <span className="inline-flex min-w-0 flex-1 items-center gap-2">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground" aria-hidden>
        <Building2 className="size-4" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{label}</span>
        <span className="block truncate text-xs text-muted-foreground">{caption}</span>
      </span>
    </span>
  );
}
