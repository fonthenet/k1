import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/shared/page-header";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/tenant";
import { ChangePasswordForm } from "@/components/modules/settings/change-password-form";
import { MyProfileForm } from "@/components/modules/settings/my-profile-form";
import { displayIdentity } from "@/lib/auth-identifier";

const LOCALES = ["ar", "en", "fr"] as const;
type ProfileLocale = (typeof LOCALES)[number];

function ReadOnlyField({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="grid gap-1.5">
      <span className="text-sm font-medium text-foreground">{label}</span>
      <span
        dir="ltr"
        className="w-fit rounded-md bg-muted px-2 py-1 font-mono text-sm text-muted-foreground"
      >
        {value}
      </span>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  );
}

export default async function MyProfilePage() {
  const ctx = await requireStaff();
  const supabase = await createClient();
  const t = await getTranslations("settings");

  const { data: profile } = await supabase
    .from("kg_profiles")
    .select("full_name, phone, locale")
    .eq("id", ctx.user.id)
    .maybeSingle();

  const locale = (LOCALES as readonly string[]).includes(profile?.locale ?? "")
    ? (profile!.locale as ProfileLocale)
    : "ar";

  return (
    <div className="space-y-6">
      <PageHeader title={t("profile.title")} description={t("profile.description")} />

      <MyProfileForm
        fullName={profile?.full_name ?? ""}
        phone={profile?.phone ?? null}
        locale={locale}
        email={displayIdentity(ctx.user.email)}
      />

      <Card className="border border-border shadow-sm ring-0">
        <CardHeader>
          <CardTitle className="text-base font-semibold">{t("profile.accessTitle")}</CardTitle>
          <CardDescription>{t("profile.accessHint")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 sm:grid-cols-3">
          <div className="grid gap-1.5">
            <span className="text-sm font-medium text-foreground">{t("profile.role")}</span>
            <span>
              <Badge className="border-transparent bg-primary/10 font-medium text-primary">
                {t(`roles.${ctx.role}`)}
              </Badge>
            </span>
            {ctx.membership.job_title && (
              <span className="text-xs text-muted-foreground">{ctx.membership.job_title}</span>
            )}
          </div>
          <ReadOnlyField
            label={t("profile.staffCode")}
            value={ctx.membership.staff_code ?? t("profile.notSet")}
          />
          <ReadOnlyField
            label={t("profile.pinCode")}
            value={ctx.membership.pin_code ?? t("profile.notSet")}
            hint={t("profile.pinHint")}
          />
        </CardContent>
      </Card>

      <ChangePasswordForm />
    </div>
  );
}
