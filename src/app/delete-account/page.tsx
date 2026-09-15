import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { LegalPage } from "@/components/landing/legal-page";

// Public, like /privacy: Google Play shows this address on the store listing
// as the place to request account deletion, so it must open without a login.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("landing.legal.deleteAccount");
  return { title: t("title") };
}

export default function DeleteAccountPage() {
  return <LegalPage kind="deleteAccount" />;
}
