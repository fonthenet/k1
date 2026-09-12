"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { StatusPill } from "@/components/shared/status-pill";
import { StructureTile } from "@/components/shared/structure-mark";
import { StructureDialog } from "./structure-dialog";
import { DeleteStructureDialog } from "./delete-structure-button";
import { structureName, type Structure } from "./class-types";
import { SOLIDARITY_CENTER_TYPES } from "@/components/modules/settings/center-types";

export interface StructureWithUsage extends Structure {
  classCount: number;
  childCount: number;
}

/**
 * The structures of the establishment, as one list.
 *
 * The same three rows the subscription bill already shows, now editable: a
 * tinted tile in the structure's own colour (the one colour spent on the row),
 * the name with the type under it only when the type says something the name
 * does not, a muted meta line with what the structure holds and which
 * inspector's registers it appears in, and one overflow menu. Never a card
 * per structure: a card is a section, and a structure is a row of this one.
 */
export function StructuresPanel({
  structures,
  isAdmin,
}: {
  structures: StructureWithUsage[];
  isAdmin: boolean;
}) {
  const t = useTranslations("classes");
  const locale = useLocale();
  const tSettings = useTranslations("settings");

  if (structures.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("structures.empty")}</p>;
  }

  const usedColors = structures.map((s) => s.color);

  return (
    <ul className="divide-y divide-border rounded-xl border border-border">
      {structures.map((s) => {
        const name = structureName(s, locale);
        const type = tSettings(`centerTypes.${s.center_type}.name`);
        const meta = [
          t("structures.classCount", { count: s.classCount }),
          t("structures.childCount", { count: s.childCount }),
          SOLIDARITY_CENTER_TYPES.includes(s.center_type)
            ? t("structures.dasIn")
            : t("structures.dasOut"),
        ].join(" · ");
        return (
          <li key={s.id} className="flex items-center gap-3 px-4 py-3">
            {/* The type is the subject here, so the tile carries its caption —
                unless a structure created at signup is simply NAMED after its
                type, in which case the caption would read "Crèche / Crèche". */}
            <StructureTile
              structure={{ ...s, name }}
              caption={type !== name ? type : undefined}
              className="min-w-0 flex-1"
            />
            <span className="hidden text-sm text-muted-foreground tabular-nums sm:block">
              {meta}
            </span>
            {!s.active && <StatusPill tone="muted">{t("structures.inactive")}</StatusPill>}
            {isAdmin && (
              <StructureRowMenu structure={s} name={name} usedColors={usedColors} />
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** One overflow per row: Modifier, and Retirer as the only destructive item. */
function StructureRowMenu({
  structure,
  name,
  usedColors,
}: {
  structure: StructureWithUsage;
  name: string;
  usedColors: string[];
}) {
  const t = useTranslations("classes");
  const tc = useTranslations("common");
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={t("structures.more")}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setEditing(true)}>
            {tc("actions.edit")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(true)}>
            {t("structures.remove")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {/* Mounted only while open, so each opening starts from the row's
          current values rather than the ones it had at first render. */}
      {editing && (
        <StructureDialog
          structure={structure}
          usedColors={usedColors}
          open={editing}
          onOpenChange={setEditing}
        />
      )}
      {deleting && (
        <DeleteStructureDialog
          structureId={structure.id}
          structureName={name}
          classCount={structure.classCount}
          childCount={structure.childCount}
          open={deleting}
          onOpenChange={setDeleting}
        />
      )}
    </>
  );
}
