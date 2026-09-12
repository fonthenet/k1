"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Building2, Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/shared/section-card";
import { StructureTile } from "@/components/shared/structure-mark";
import { structureName, type Structure } from "@/components/modules/classes/class-types";
import { cn } from "@/lib/utils";
import { setMemberStructures } from "./structure-actions";

/**
 * Where a member of staff works when no class says so.
 *
 * An educator's structures are the ones her classes belong to, and the
 * Classes card already names them — so this card is for the cook, the guard
 * and the secretary only: the people on no class, whom the director places
 * directly. Tick the crèche, tick the école, tick both for the kitchen.
 *
 * The chips are the settings structure tiles; a ticked one gets the one
 * "selected" mark — the primary border — and its glyph becomes a check.
 * Renders nothing for a one-structure building: there is nothing to choose.
 */
export function StructuresCard({
  membershipId,
  structures,
  direct,
  canManage,
}: {
  membershipId: string;
  structures: Structure[];
  /** Structure ids assigned directly (kg_membership_structures). */
  direct: string[];
  canManage: boolean;
}) {
  const t = useTranslations("staff.structures");
  const locale = useLocale();
  const router = useRouter();
  const [picked, setPicked] = useState<Set<string>>(new Set(direct));
  const [pending, startTransition] = useTransition();

  if (structures.length < 2) return null;

  const dirty = picked.size !== direct.length || direct.some((id) => !picked.has(id));

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function save() {
    startTransition(async () => {
      const res = await setMemberStructures(membershipId, [...picked]);
      if (res.ok) {
        toast.success(t("saved"));
        router.refresh();
      } else {
        toast.error(t("error"));
      }
    });
  }

  return (
    <SectionCard
      icon={Building2}
      tone={1}
      title={t("title")}
      hint={t("hint")}
      className="mb-6"
      action={
        canManage && dirty ? (
          <Button size="sm" onClick={save} disabled={pending}>
            {t("save")}
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-wrap gap-2">
        {structures.map((s) => {
          const on = picked.has(s.id);
          return (
            <button
              key={s.id}
              type="button"
              disabled={!canManage || pending}
              onClick={() => toggle(s.id)}
              aria-pressed={on}
              className={cn(
                "relative rounded-xl border px-2.5 py-1.5 text-start transition-colors",
                on ? "border-primary ring-1 ring-primary" : "border-border hover:bg-muted/50",
                !canManage && "cursor-default"
              )}
            >
              <StructureTile
                structure={{ name: structureName(s, locale), color: s.color, center_type: s.center_type }}
              />
              {/* The tile's glyph becomes a check: painted over the tile on an
                  opaque card-coloured square so the tint is not doubled. */}
              {on && (
                <span className="absolute inset-y-0 start-2.5 flex items-center bg-card" aria-hidden>
                  <span
                    className="flex size-7 items-center justify-center rounded-lg"
                    style={{ backgroundColor: `${s.color}1f`, color: s.color }}
                  >
                    <Check className="size-4" />
                  </span>
                </span>
              )}
            </button>
          );
        })}
      </div>
    </SectionCard>
  );
}
