"use client";

import { useTranslations } from "next-intl";
import { BookOpen, HandCoins, LayoutDashboard, Tags, Wallet } from "lucide-react";
import { SectionTabs } from "@/components/shared/section-tabs";

/**
 * The six accounting routes as the settings-style tab bar.
 *
 * Each tab is its own href. The overview matches exactly, because every other
 * accounting route begins with `/accounting`; the four lists match by prefix
 * so that a payroll run and its payslips keep the Paie tab lit. No counts —
 * every number this module has is already on the page it belongs to.
 *
 * Prop-less on purpose: `payroll/[id]/page.tsx` renders it as `<AccountingNav />`
 * and that signature is the contract.
 */
export function AccountingNav() {
  const t = useTranslations("accounting");
  return (
    <SectionTabs
      ariaLabel={t("title")}
      tabs={[
        { key: "overview", label: t("nav.overview"), icon: LayoutDashboard, href: "/accounting" },
        {
          key: "transactions",
          label: t("nav.transactions"),
          icon: BookOpen,
          href: "/accounting/transactions",
          match: "prefix",
        },
        {
          key: "categories",
          label: t("nav.categories"),
          icon: Tags,
          href: "/accounting/categories",
          match: "prefix",
        },
        {
          key: "payroll",
          label: t("nav.payroll"),
          icon: Wallet,
          href: "/accounting/payroll",
          match: "prefix",
        },
        {
          key: "advances",
          label: t("nav.advances"),
          icon: HandCoins,
          href: "/accounting/advances",
          match: "prefix",
        },
      ]}
    />
  );
}
