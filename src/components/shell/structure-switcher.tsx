"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Building2, Check, ChevronsUpDown } from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { setActiveStructure } from "@/app/actions/structure";
import { centerTypeOption } from "@/components/modules/settings/center-types";
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
  const locale = useLocale();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  if (structures.length < 2) return null;

  const active = structures.find((s) => s.id === activeId) ?? null;
  const ActiveIcon = active ? centerTypeOption(active.center_type).Icon : Building2;

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
            building" there is nothing to signal, so the dot goes grey rather
            than picking a structure's colour arbitrarily. */}
        <span
          className="flex size-7 shrink-0 items-center justify-center rounded-lg"
          style={
            active
              ? { backgroundColor: `${active.color}1f`, color: active.color }
              : undefined
          }
        >
          <ActiveIcon className={cn("size-4", !active && "text-muted-foreground")} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium">
            {active ? structureName(active, locale) : t("all")}
          </span>
          <span className="block truncate text-[11px] text-muted-foreground">
            {active ? t("viewing") : t("allHint", { count: structures.length })}
          </span>
        </span>
        <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          {t("label")}
        </DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => choose(null)} className="gap-2">
          <Building2 className="size-4 text-muted-foreground" />
          <span className="flex-1 truncate">{t("all")}</span>
          {!active && <Check className="size-4 text-primary" />}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {structures.map((s) => {
          const { Icon } = centerTypeOption(s.center_type);
          return (
            <DropdownMenuItem key={s.id} onSelect={() => choose(s.id)} className="gap-2">
              <Icon className="size-4" style={{ color: s.color }} />
              <span className="flex-1 truncate">{structureName(s, locale)}</span>
              {active?.id === s.id && <Check className="size-4 text-primary" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
