"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { PencilIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CENTER_TYPE_ICON } from "./center-types";
import { StructuresPanel, type StructureWithUsage } from "@/components/modules/classes/structures-panel";
import { StructureDialog } from "@/components/modules/classes/structure-dialog";
import { structureName } from "@/components/modules/classes/class-types";

/**
 * What this establishment runs — folded shut.
 *
 * The seven-card vertical picker belongs to the founder wizard: it is a
 * setup decision, made once, and it was then splayed across the settings page
 * for the rest of the crèche's life, taking more room than the address. Worse,
 * it was bound to kg_tenants.center_type — a single column — so an
 * establishment that ticked two at signup was shown only the first, quietly
 * contradicting what the founder had just done.
 *
 * The structures are the truth, so this reads them. Closed it is one line of chips;
 * open it is the full management panel, which is also the only place structures are
 * created or renamed now that the Classes page no longer carries a tab for it.
 */
export function EstablishmentStructures({
  structures,
  isAdmin,
}: {
  structures: StructureWithUsage[];
  isAdmin: boolean;
}) {
  const t = useTranslations("settings");
  const tClasses = useTranslations("classes");
  const locale = useLocale();
  const [open, setOpen] = useState(false);

  return (
    <div className="grid gap-2">
      {/* The heading and hint belong to the card around this now — they were
          here from when this sat folded inside the identity form, and read
          twice once it got a card of its own. */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {isAdmin && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
          >
            <PencilIcon data-icon="inline-start" />
            {open ? t("school.structuresDone") : t("school.structuresEdit")}
          </Button>
        )}
      </div>

      {!open && (
        <div className="flex flex-wrap items-stretch gap-2">
          {structures.map((s) => {
            const Icon = CENTER_TYPE_ICON[s.center_type];
            return (
              <span
                key={s.id}
                className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm"
              >
                <span
                  className="flex size-7 shrink-0 items-center justify-center rounded-lg text-foreground"
                  style={{
                    backgroundColor: `color-mix(in oklch, ${s.color} 20%, transparent)`,
                    boxShadow: `inset 0 0 0 1px color-mix(in oklch, ${s.color} 45%, transparent)`,
                  }}
                  aria-hidden
                >
                  <Icon className="size-4" />
                </span>
                <span className="min-w-0">
                  <span className="block leading-tight font-medium">
                    {structureName(s, locale)}
                  </span>
                  {/* The type only when it adds something. A structure created at
                      signup is NAMED after its vertical, so printing both gave
                      "Crèche / Crèche" on every chip. */}
                  {structureName(s, locale) !== t(`centerTypes.${s.center_type}.name`) && (
                    <span className="block text-xs text-muted-foreground">
                      {t(`centerTypes.${s.center_type}.name`)}
                    </span>
                  )}
                </span>
              </span>
            );
          })}
          {/* Adding an activity is a real thing a director does — a jardin
              opens next to the crèche in September — and it was reachable only
              by first pressing "Modifier", which reads as editing what is
              already there rather than adding to it. */}
          {isAdmin && <StructureDialog trigger="chip" />}
        </div>
      )}

      {open && (
        <div className="grid gap-3 rounded-xl border border-dashed border-border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground text-pretty">
              {tClasses("structures.dialogDescription")}
            </p>
            {isAdmin && <StructureDialog />}
          </div>
          <StructuresPanel structures={structures} isAdmin={isAdmin} />
        </div>
      )}
    </div>
  );
}
