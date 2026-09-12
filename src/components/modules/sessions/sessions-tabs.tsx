"use client";

import { useTranslations } from "next-intl";
import { CalendarClock, ListChecks } from "lucide-react";
import { SectionTabs } from "@/components/shared/section-tabs";

/**
 * Planning | Programmes as the settings-style tab bar, one href per half of
 * the module. It sits under the PageHeader, never inside it: a solid pill in
 * the header row read as a second primary button.
 *
 * No counts: today's sessions and the active programmes are already tiles on
 * the planning page, and the programmes page says its count in the filter
 * chip. A client component because the tab icons are component functions,
 * which a server page cannot hand across the boundary.
 */
export function SessionsTabs() {
  const t = useTranslations("sessions");
  return (
    <SectionTabs
      ariaLabel={t("title")}
      tabs={[
        { key: "schedule", label: t("tabs.schedule"), icon: CalendarClock, href: "/sessions" },
        { key: "programs", label: t("tabs.programs"), icon: ListChecks, href: "/sessions/programs" },
      ]}
    />
  );
}
