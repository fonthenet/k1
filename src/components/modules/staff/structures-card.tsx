"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { structureName, type Structure } from "@/components/modules/classes/class-types";
import { centerTypeOption } from "@/components/modules/settings/center-types";
import { cn } from "@/lib/utils";
import { setMemberStructures } from "./structure-actions";

/**
 * Where a member of staff works — one structure, or several.
 *
 * Two kinds of chip. A structure the person is assigned to DIRECTLY is a
 * toggle: tick the crèche, tick the école, tick both for the cook. A
 * structure they are in THROUGH A CLASS is shown too, ticked and locked,
 * with the class named underneath — unassigning them from the école is done
 * by taking them off the école's class, not by unticking a chip that would
 * come straight back. The union is what everything else reads.
 *
 * Renders nothing for a one-structure building: there is nothing to choose.
 */
export function StructuresCard({
  membershipId,
  structures,
  direct,
  viaClasses,
  canManage,
}: {
  membershipId: string;
  structures: Structure[];
  /** Structure ids assigned directly (kg_membership_structures). */
  direct: string[];
  /** Structure id → class names that put the person there. */
  viaClasses: Record<string, string[]>;
  canManage: boolean;
}) {
  const t = useTranslations("staff.structures");
  const locale = useLocale();
  const router = useRouter();
  const [picked, setPicked] = useState<Set<string>>(new Set(direct));
  const [pending, startTransition] = useTransition();

  if (structures.length < 2) return null;

  const dirty =
    picked.size !== direct.length || direct.some((id) => !picked.has(id));

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
    <Card className="border border-border shadow-sm ring-0">
      <CardHeader>
        <CardTitle className="text-base font-semibold">{t("title")}</CardTitle>
        <p className="text-xs text-pretty text-muted-foreground">{t("hint")}</p>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="flex flex-wrap gap-2">
          {structures.map((s) => {
            const { Icon } = centerTypeOption(s.center_type);
            const classes = viaClasses[s.id] ?? [];
            const locked = classes.length > 0;
            const on = locked || picked.has(s.id);
            return (
              <button
                key={s.id}
                type="button"
                disabled={!canManage || locked || pending}
                onClick={() => toggle(s.id)}
                aria-pressed={on}
                className={cn(
                  "flex items-start gap-2.5 rounded-xl border px-3 py-2 text-start transition",
                  on ? "border-transparent" : "border-border bg-background hover:bg-muted/50",
                  (!canManage || locked) && "cursor-default"
                )}
                style={on ? { backgroundColor: `${s.color}14`, boxShadow: `inset 0 0 0 1.5px ${s.color}` } : undefined}
              >
                <span
                  className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-lg"
                  style={{ backgroundColor: `${s.color}1f`, color: s.color }}
                >
                  {on ? <Check className="size-3.5" /> : <Icon className="size-3.5" />}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{structureName(s, locale)}</span>
                  <span className="block text-xs text-muted-foreground">
                    {locked ? t("viaClasses", { classes: classes.join(", ") }) : on ? t("direct") : t("notHere")}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        {canManage && dirty && (
          <div className="flex justify-end">
            <Button size="sm" onClick={save} disabled={pending}>
              {t("save")}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
