import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { LegalPage } from "@/components/landing/legal-page";

// Public, like the landing page: not in PROTECTED_PREFIXES on purpose. A
// parent reading what happens to their child's data must not need an account.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("landing.legal.privacy");
  return { title: t("title") };
}

export default function PrivacyPage() {
  return <LegalPage kind="privacy" />;
}
