import { getTenantContext, signedMediaUrl } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { PortalTopbar } from "@/components/modules/portal/portal-topbar";
import { PortalTabs } from "@/components/modules/portal/portal-tabs";
import { NotificationBell } from "@/components/modules/portal/notification-bell";
import { countUnreadMessages } from "@/components/modules/comms/queries";
import { displayIdentity } from "@/lib/auth-identifier";

/**
 * Mobile-first shell for the parent portal: sticky top bar, centered
 * max-w-lg content, sticky bottom tab navigation. Same "Algiers" tokens as
 * the rest of the product — the warmth comes from a soft gold wash at the
 * top of the page, not from a separate palette.
 * Role may be `parent`; staff visiting /portal is fine.
 */
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getTenantContext();
  const supabase = await createClient();
  // RLS keeps both queries to this user's own rows.
  const [{ data: profile }, { count: unread }, logoUrl, unreadThreads] = await Promise.all([
    supabase.from("kg_profiles").select("full_name").eq("id", ctx.user.id).maybeSingle(),
    supabase
      .from("kg_notifications")
      .select("id", { count: "exact", head: true })
      .is("read_at", null),
    signedMediaUrl(ctx.tenant.logo_url),
    // The Messages tab needs no stream of its own: the bell above refreshes
    // this layout on every notification, and a staff reply always raises one
    // (migration 0012). One subscription, two badges.
    countUnreadMessages(ctx.tenant.id, ctx.user.id),
  ]);

  return (
    <div className="min-h-dvh bg-muted/40">
      <PortalTopbar
        tenantName={ctx.tenant.name}
        userName={profile?.full_name || displayIdentity(ctx.user.email) || ""}
        email={displayIdentity(ctx.user.email)}
        logoUrl={logoUrl}
        notifications={<NotificationBell userId={ctx.user.id} unreadCount={unread ?? 0} />}
      />
      <main className="mx-auto w-full max-w-lg px-4 pb-28 pt-5">{children}</main>
      <PortalTabs unreadMessages={unreadThreads} />
    </div>
  );
}
