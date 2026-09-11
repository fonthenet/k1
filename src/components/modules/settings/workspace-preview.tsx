"use client";

import { useTranslations } from "next-intl";
import type { CenterType } from "./center-types";
import { CENTER_TYPE_ICON } from "./center-types";

export function WorkspacePreview({ types }: { types: CenterType[] }) {
  const t = useTranslations("dashboard.workspace");
  return (
    <section aria-label={t("preview")} className="rounded-xl border border-primary/20 bg-primary/5 p-4" aria-live="polite">
      <h3 className="text-sm font-semibold">{t("preview")}</h3>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        {types.map((type) => {
          const Icon = CENTER_TYPE_ICON[type];
          return (
            <div key={type} className="flex gap-3">
              <Icon aria-hidden className="mt-1 size-5 shrink-0 text-primary" />
              <div>
                <p className="text-sm font-medium">{t(`${type}.title`)}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t(`${type}.description`)}</p>
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-4 border-t border-primary/10 pt-3 text-xs leading-relaxed text-muted-foreground">{t("local")}</p>
    </section>
  );
}
