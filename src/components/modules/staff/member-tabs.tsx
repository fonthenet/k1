"use client";

import { useTranslations } from "next-intl";
import { CalendarDays, Clock, CreditCard, Wallet } from "lucide-react";
import { SectionTabs, type SectionTab } from "@/components/shared/section-tabs";

export type MemberTabKey = "timesheets" | "leaves" | "cards" | "salary";

/**
 * Pointages | Congés | Cartes | Salaire as the settings-style tab bar,
 * switched by ?tab=.
 *
 * A client component of its own because the tab icons are components, and
 * a server page cannot hand a component function across the boundary. The
 * page decides which keys the reader may see and which is open by default.
 */
export function MemberTabs({
  keys,
  defaultKey,
  ariaLabel,
}: {
  keys: MemberTabKey[];
  defaultKey: MemberTabKey;
  ariaLabel: string;
}) {
  const t = useTranslations("staff");
  const tCred = useTranslations("credentials");
  const all: Record<MemberTabKey, SectionTab> = {
    timesheets: { key: "timesheets", label: t("detail.tabs.timesheets"), icon: Clock },
    leaves: { key: "leaves", label: t("detail.tabs.leaves"), icon: CalendarDays },
    cards: { key: "cards", label: tCred("title"), icon: CreditCard },
    salary: { key: "salary", label: t("detail.tabs.salary"), icon: Wallet },
  };
  return <SectionTabs tabs={keys.map((k) => all[k])} defaultKey={defaultKey} ariaLabel={ariaLabel} />;
}
