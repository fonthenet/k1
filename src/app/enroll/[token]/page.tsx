// PUBLIC enrollment page — a parent opens this link on their phone.
// No auth required to view; the wizard handles signup/login itself.

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { EnrollWizard } from "@/components/modules/enroll/enroll-wizard";
import type { EnrollLinkData, WizardUser } from "@/components/modules/enroll/types";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("enroll");
  return { title: t("meta.title") };
}

async function InvalidLink() {
  const t = await getTranslations("enroll");
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background bg-gradient-to-b from-gold-muted/60 via-background to-background px-4">
      <div className="w-full max-w-md rounded-3xl border bg-card p-8 text-center shadow-sm">
        <div className="mb-4 text-5xl" aria-hidden>
          🌱
        </div>
        <h1 className="text-xl font-bold tracking-tight">{t("invalid.title")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("invalid.message")}</p>
        <p className="mt-4 text-sm font-medium">{t("invalid.hint")}</p>
      </div>
    </div>
  );
}

export default async function EnrollPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("kg_get_enroll_link", { p_token: token });
  if (error || !data) {
    return <InvalidLink />;
  }
  const link = data as unknown as EnrollLinkData;

  const {
    data: { user },
  } = await supabase.auth.getUser();

  let initialUser: WizardUser | null = null;
  if (user) {
    const metaName =
      typeof user.user_metadata?.full_name === "string"
        ? (user.user_metadata.full_name as string)
        : null;
    let fullName = metaName;
    if (!fullName) {
      const { data: profile } = await supabase
        .from("kg_profiles")
        .select("full_name")
        .eq("id", user.id)
        .maybeSingle();
      fullName = profile?.full_name || null;
    }
    initialUser = { id: user.id, email: user.email ?? null, fullName };
  }

  return <EnrollWizard token={token} link={link} initialUser={initialUser} />;
}
