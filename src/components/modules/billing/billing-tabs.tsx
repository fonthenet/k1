"use client";

import { useTranslations } from "next-intl";
import { AlertCircle, Receipt, Tags } from "lucide-react";
import { SectionTabs } from "@/components/shared/section-tabs";

/**
 * Factures | Formules et tarifs | Impayés as the settings-style tab bar, one
 * href per sibling route.
 *
 * A client component of its own because the tab icons are components, and a
 * server page cannot hand a component function across the boundary. No
 * counts: the hub does not load the plan or arrears totals, and a bar that
 * shows a number on one tab and nothing on the others reads as broken.
 */
export function BillingTabs() {
  const t = useTranslations("billing");
  return (
    <SectionTabs
      ariaLabel={t("hub.title")}
      tabs={[
        { key: "invoices", label: t("hub.invoicesTab"), icon: Receipt, href: "/billing" },
        { key: "plans", label: t("hub.plansLink"), icon: Tags, href: "/billing/plans" },
        { key: "arrears", label: t("hub.arrearsLink"), icon: AlertCircle, href: "/billing/arrears" },
      ]}
    />
  );
}
