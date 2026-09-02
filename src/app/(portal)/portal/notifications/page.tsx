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

  // One bell for every crèche the account belongs to — the rows carry their
  // own tenant_id — but a row from ANOTHER crèche has to say so, and its deep
  // link only resolves once the tenant cookie points there. The list gets the
  // names to label such rows and the active id to tell them apart.
  const tenantNames: Record<string, string> = {};
  for (const m of ctx.memberships) {
    if (m.kg_tenants) tenantNames[m.tenant_id] = m.kg_tenants.name;
  }

  return (
    <NotificationList
      initial={(data ?? []) as KgNotification[]}
      userId={ctx.user.id}
      nowIso={new Date().toISOString()}
      activeTenantId={ctx.tenant.id}
      tenantNames={tenantNames}
    >
      {/* The toggle renders nothing while it works out what the browser
          supports, and nothing is the right answer for the card too. */}
      <Card className="px-4 empty:hidden">
        <PushToggle variant="parent" />
      </Card>
    </NotificationList>
  );
}
