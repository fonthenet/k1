import { Baby, IdCard, UserRoundCheck, Users } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { StatCard } from "@/components/shared/stat-card";
import { requireAdmin } from "@/lib/tenant";
import { loadBadgesData } from "@/components/modules/settings/badges-data";
import { BadgesRegister } from "@/components/modules/settings/badges-register";
import { BadgesSettingsCard } from "@/components/modules/settings/badges-settings-card";
import { KioskSettingsCard } from "@/components/modules/settings/kiosk-settings-card";
import { badgeSettings } from "@/lib/badge-settings";
import { kioskSettings } from "@/lib/kiosk-settings";
import { PrintBadgesButton } from "@/components/modules/settings/print-badges-button";

/** "3 / 47" — a ratio is an ltr island, or Arabic reads it backwards. */
function Ratio({ n, total }: { n: number; total: number }) {
  return (
    <span dir="ltr">
      {n} / {total}
    </span>
  );
}

/**
 * Badges and cards: who can open the door with a proximity card, who cannot
 * yet, and the reader that hands them out. The register itself is a client
 * component because the page's one primary arms a scan mode that lives in
 * the table; the stat strip and the reader card are composed here and
 * handed down as a slot.
 */
export default async function BadgesSettingsPage() {
  const ctx = await requireAdmin();
  const locale = await getLocale();
  const t = await getTranslations("settings.badges");
  const { rows, stats, usesCards, generatedAt } = await loadBadgesData(ctx, locale);

  return (
    <BadgesRegister
      rows={rows}
      structures={ctx.structures.filter((s) => s.active)}
      now={generatedAt}
      usesCards={usesCards}
      title={t("title")}
      description={t("description")}
      headerAction={<PrintBadgesButton tenantId={ctx.tenant.id} structures={ctx.structures.filter((s) => s.active)} />}
      above={
        <>
          {/* Four tiles in the settings column leave each ~240px: the label
              is the noun alone and the hint says "with a card", so the
              ratio never pushes the label into an ellipsis. */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label={t("stats.children")}
              value={<Ratio n={stats.children.withCard} total={stats.children.total} />}
              hint={t("stats.childrenHint")}
              icon={<Baby className="size-5" />}
            />
            <StatCard
              label={t("stats.guardians")}
              value={<Ratio n={stats.guardians.withCard} total={stats.guardians.total} />}
              hint={`${t("stats.guardiansHint")} · ${t("pin.withPin", { count: stats.guardians.withPin })}`}
              icon={<Users className="size-5" />}
            />
            <StatCard
              label={t("stats.staff")}
              value={<Ratio n={stats.staff.withCard} total={stats.staff.total} />}
              hint={t("stats.staffHint")}
              icon={<UserRoundCheck className="size-5" />}
            />
            <StatCard
              label={t("stats.usedThisWeek")}
              value={stats.usedThisWeek}
              hint={t("stats.usedThisWeekHint")}
              icon={<IdCard className="size-5" />}
              tone="success"
            />
          </div>

          <BadgesSettingsCard settings={badgeSettings(ctx.tenant.settings)} />
          <KioskSettingsCard settings={kioskSettings(ctx.tenant.settings)} />
        </>
      }
    />
  );
}
