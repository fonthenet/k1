"use client";

import { useLocale, useTranslations } from "next-intl";
import { Building2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/empty-state";
import { StructureDialog } from "./structure-dialog";
import { DeleteStructureButton } from "./delete-structure-button";
import { structureName, type Structure } from "./class-types";
import { SOLIDARITY_CENTER_TYPES } from "@/components/modules/settings/center-types";

export interface StructureWithUsage extends Structure {
  classCount: number;
  childCount: number;
  classNames: string[];
}

/**
 * The structures of the establishment.
 *
 * Beside the classes rather than in Settings for the same reason rooms are: a
 * structure only means anything as a grouping of classes, and the person setting
 * classes up is the person who decides which structure they belong to.
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
    return (
      <EmptyState
        icon={
          <span className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary [&>svg]:size-7">
            <Building2 />
          </span>
        }
        title={t("structures.empty")}
        description={t("structures.emptyDescription")}
        action={isAdmin ? <StructureDialog /> : undefined}
      />
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {structures.map((s) => (
        <Card key={s.id}>
          <CardContent>
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 items-start gap-3">
                <span
                  className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl text-foreground"
                  style={{
                    backgroundColor: `color-mix(in oklch, ${s.color} 20%, transparent)`,
                    boxShadow: `inset 0 0 0 1px color-mix(in oklch, ${s.color} 45%, transparent)`,
                  }}
                  aria-hidden
                >
                  <Building2 className="size-5" />
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="truncate font-semibold text-foreground">
                      {structureName(s, locale)}
                    </h3>
                    {!s.active && (
                      <Badge variant="tinted" className="bg-muted text-muted-foreground">
                        {t("structures.inactive")}
                      </Badge>
                    )}
                  </div>
                  {/* The vertical only when it adds something: a structure created
                      at signup is NAMED after it, so both lines read the same. */}
                  {structureName(s, locale) !==
                    tSettings(`centerTypes.${s.center_type}.name`) && (
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {tSettings(`centerTypes.${s.center_type}.name`)}
                    </p>
                  )}
                </div>
              </div>
              {isAdmin && (
                <div className="flex shrink-0 items-center gap-0.5">
                  <StructureDialog structure={s} />
                  <DeleteStructureButton
                    structureId={s.id}
                    structureName={structureName(s, locale)}
                    classCount={s.classCount}
                    childCount={s.childCount}
                  />
                </div>
              )}
            </div>

            {/* Which inspector's registers this structure appears in — the whole
                point of the split, and not obvious from the name. */}
            <p className="mt-3 rounded-lg bg-muted/40 px-2.5 py-1.5 text-xs text-muted-foreground">
              {SOLIDARITY_CENTER_TYPES.includes(s.center_type)
                ? t("structures.registerSolidarity")
                : t("structures.registerOther")}
            </p>

            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border/60 pt-3 text-sm">
              <span className="text-muted-foreground">
                {t("structures.classCount", { count: s.classCount })}
              </span>
              <span className="text-muted-foreground">
                {t("structures.childCount", { count: s.childCount })}
              </span>
            </div>
            {s.classNames.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {s.classNames.map((n) => (
                  <Badge key={n} variant="tinted" className="bg-primary/10 text-primary">
                    {n}
                  </Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
