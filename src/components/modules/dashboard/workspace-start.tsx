import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { KgRole } from "@/lib/types";
import { workspaceNav } from "@/components/shell/nav-items";
import type { WorkspaceType } from "@/components/modules/settings/workspace-profile";
import { cn } from "@/lib/utils";
import { isPrivateSchool } from "@/components/modules/settings/private-school-types";

export async function WorkspaceStart({ type, role }: { type: WorkspaceType; role: KgRole }) {
  const [t, nav] = await Promise.all([getTranslations("dashboard.workspace"), getTranslations("common.nav")]);
  const tl = await getTranslations("learning");
  const items = workspaceNav(role, type).primary.filter((item) => item.key !== "dashboard" && item.key !== "incidents");
  const school = isPrivateSchool(type);
  const scheduleFirst = ["edu_center", "therapy_center", "camp", "private_middle", "private_secondary"].includes(type);
  return (
    <section aria-labelledby="workspace-title" className="overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/10 via-card to-card">
      <div className="p-5">
        <p className="text-xs font-semibold text-primary">{t("eyebrow")}</p>
        <h2 id="workspace-title" className="mt-1 text-xl font-semibold">{t(`${type}.title`)}</h2>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{t(`${type}.description`)}</p>
      </div>
      <div className={cn("grid gap-3 px-5 pb-5", scheduleFirst ? "md:grid-cols-2" : "sm:grid-cols-2 xl:grid-cols-4")}>
        {items.map((item, i) => (
          <Link key={item.key} href={item.href} className={cn("flex items-center gap-3 rounded-xl border border-border bg-background p-4 hover:border-primary/50 focus-visible:outline-2 focus-visible:outline-ring", scheduleFirst && i === 0 && "md:row-span-3 md:flex-col md:items-start md:justify-center md:p-6")}>
            <item.icon aria-hidden className={cn("shrink-0 text-primary", scheduleFirst && i === 0 ? "size-8" : "size-5")} />
            <span className="font-medium">{item.key === "learning" ? tl("title") : school && item.key === "children" ? t("pupils") : nav(item.key)}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
