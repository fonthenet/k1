import { ClipboardList, Inbox, MessageSquareText, Sparkles } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/shared/page-header";
import { PushToggle } from "@/components/shared/push-toggle";
import { requireStaff } from "@/lib/tenant";

/**
 * The events whose DB triggers fan out to staff rather than to families
 * (see supabase/migrations/0012_kg_notifications.sql). Listed in the order the
 * office actually cares about them: someone waiting outside first, chores last.
 */
const STAFF_EVENTS = [
  { key: "application", Icon: Inbox },
  { key: "message", Icon: MessageSquareText },
  { key: "activity_request", Icon: Sparkles },
  { key: "task", Icon: ClipboardList },
] as const;

/** Any staff member may manage their own alerts — this is a per-person setting,
 *  not a kindergarten-wide one, so it is deliberately not admin-gated. */
export default async function NotificationSettingsPage() {
  await requireStaff();
  const t = await getTranslations("settings");

  return (
    <div>
      <PageHeader title={t("notifications.title")} description={t("notifications.description")} />

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>{t("notifications.deviceTitle")}</CardTitle>
            <CardDescription>{t("notifications.deviceDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <PushToggle variant="staff" />
            <p className="text-xs text-muted-foreground">{t("notifications.deviceHint")}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("notifications.eventsTitle")}</CardTitle>
            <CardDescription>{t("notifications.eventsDescription")}</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border">
              {STAFF_EVENTS.map(({ key, Icon }) => (
                <li key={key} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                  <span
                    className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
                    aria-hidden
                  >
                    <Icon className="size-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">
                      {t(`notifications.events.${key}.title`)}
                    </p>
                    <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">
                      {t(`notifications.events.${key}.description`)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
