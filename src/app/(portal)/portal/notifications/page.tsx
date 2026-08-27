import { Card } from "@/components/ui/card";
import { PushToggle } from "@/components/shared/push-toggle";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/tenant";
import type { KgNotification } from "@/lib/notifications";
import { NotificationList } from "@/components/modules/portal/notification-list";

/**
 * The family's notifications. A full page rather than a dropdown: the portal
 * is a phone surface, and a panel anchored to a bell is a poor place to read
 * a week of arrivals, journals and messages.
 */
export default async function PortalNotificationsPage() {
  const ctx = await getTenantContext();
  const supabase = await createClient();

  // Policy `n_sel` already restricts kg_notifications to `user_id = auth.uid()`,
  // so the query needs no owner filter of its own.
  const { data } = await supabase
    .from("kg_notifications")
    .select("id, tenant_id, user_id, type, title, body, data, read_at, created_at")
    .order("created_at", { ascending: false })
    .limit(100);

  return (
    <NotificationList
      initial={(data ?? []) as KgNotification[]}
      userId={ctx.user.id}
      nowIso={new Date().toISOString()}
    >
      {/* The toggle renders nothing while it works out what the browser
          supports, and nothing is the right answer for the card too. */}
      <Card className="px-4 empty:hidden">
        <PushToggle variant="parent" />
      </Card>
    </NotificationList>
  );
}
