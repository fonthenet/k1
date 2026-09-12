"use client";

import { useTranslations } from "next-intl";
import { BookOpen, CalendarDays, ClipboardCheck } from "lucide-react";
import { SectionTabs } from "@/components/shared/section-tabs";

/**
 * The three learning sections as routes — /learning/timetable, /learning
 * (programmes), /learning/assessments — drawn as the settings tab bar. Routes
 * rather than a ?tab= switch so the back button, a bookmark and a link from
 * a class page all land on the right section, and so the three sections are
 * three files that three people can work on at once.
 *
 * A crèche or a camp has no Programmes tab (spec D16): its Pédagogie lands
 * on the week, and a tab that led back to the week would be a dead click.
 * The page that renders the bar decides, since it has already resolved the
 * scope's profile to choose its own landing.
 */
export function LearningTabs({
  counts,
  showPrograms = true,
}: {
  counts?: { programs?: number; assessments?: number };
  showPrograms?: boolean;
}) {
  const t = useTranslations("learning.tabs");
  return (
    <SectionTabs
      ariaLabel={t("label")}
      tabs={[
        { key: "timetable", label: t("timetable"), icon: CalendarDays, href: "/learning/timetable" },
        ...(showPrograms
          ? [{ key: "programs", label: t("programs"), icon: BookOpen, href: "/learning", count: counts?.programs }]
          : []),
        { key: "assessments", label: t("assessments"), icon: ClipboardCheck, href: "/learning/assessments", count: counts?.assessments },
      ]}
    />
  );
}
