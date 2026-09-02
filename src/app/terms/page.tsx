import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { LegalPage } from "@/components/landing/legal-page";

// Public, like the landing page: not in PROTECTED_PREFIXES on purpose.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("landing.legal.terms");
  return { title: t("title") };
}

export default function TermsPage() {
  return <LegalPage kind="terms" />;
}
