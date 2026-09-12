"use client";

import { useTranslations } from "next-intl";
import { BookMarked, CalendarCheck, Receipt, Users } from "lucide-react";
import { SectionTabs } from "@/components/shared/section-tabs";

/**
 * Présences | Facturation | Équipe | Registres as the settings-style tab bar,
 * switched by ?tab= so a month change and a reload land on the same section.
 *
 * A client component of its own because the tab icons are components, and a
 * server page cannot hand a component function across the boundary. The month
 * survives a tab switch because SectionTabs copies the query string into every
 * tab link.
 */
export function ReportsTabs() {
  const t = useTranslations("reports");
  return (
    <SectionTabs
      ariaLabel={t("title")}
      defaultKey="attendance"
      tabs={[
        { key: "attendance", label: t("tabs.attendance"), icon: CalendarCheck },
        { key: "billing", label: t("tabs.billing"), icon: Receipt },
        { key: "team", label: t("tabs.team"), icon: Users },
        { key: "registers", label: t("tabs.registers"), icon: BookMarked },
      ]}
    />
  );
}
