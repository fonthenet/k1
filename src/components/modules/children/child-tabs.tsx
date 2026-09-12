"use client";

import { useTranslations } from "next-intl";
import { CalendarDays, FileText, HeartPulse, ShieldCheck, User, Wallet } from "lucide-react";
import { SectionTabs, type SectionTab } from "@/components/shared/section-tabs";
import { CHILD_TABS, type ChildTabKey } from "./types";

/**
 * Profil | Santé | Présences | Facturation | Documents | Consentements as
 * the settings-style tab bar, switched by ?tab=.
 *
 * A client component of its own because the tab icons are components, and
 * a server page cannot hand a component function across the boundary. The
 * page reads the same param and renders only the open section.
 */
export function ChildTabs({ ariaLabel }: { ariaLabel: string }) {
  const t = useTranslations("children");
  const icons: Record<ChildTabKey, SectionTab["icon"]> = {
    profile: User,
    health: HeartPulse,
    attendance: CalendarDays,
    billing: Wallet,
    documents: FileText,
    consents: ShieldCheck,
  };
  return (
    <SectionTabs
      tabs={CHILD_TABS.map((key) => ({ key, label: t(`profile.tabs.${key}`), icon: icons[key] }))}
      defaultKey="profile"
      ariaLabel={ariaLabel}
    />
  );
}
