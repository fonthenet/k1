"use client";

import { useTranslations } from "next-intl";
import { DoorOpen, School } from "lucide-react";
import { SectionTabs } from "@/components/shared/section-tabs";

/**
 * Classes | Salles as the settings-style tab bar, switched by ?tab=.
 *
 * A client component of its own because the tab icons are components, and
 * a server page cannot hand a component function across the boundary.
 */
export function ClassesTabs({ classCount, roomCount }: { classCount: number; roomCount: number }) {
  const t = useTranslations("classes.list");
  return (
    <SectionTabs
      ariaLabel={t("title")}
      defaultKey="classes"
      tabs={[
        { key: "classes", label: t("tabClasses"), icon: School, count: classCount },
        { key: "rooms", label: t("tabRooms"), icon: DoorOpen, count: roomCount },
      ]}
    />
  );
}
