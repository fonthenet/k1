import { requireStaff, signedMediaUrl } from "@/lib/tenant";
import { getPlatformContext } from "@/lib/platform";
import { createClient } from "@/lib/supabase/server";
import { Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";
import { SupportWidget } from "@/components/modules/support/support-widget";
import { getSupportSummary } from "@/components/modules/support/data";
import { displayIdentity } from "@/lib/auth-identifier";

/**
 * Inset shell: two floating panels on a tinted ground, rather than the flush
 * full-bleed frame with 1px rules that every admin template ships.
 *
 * The gap is the point — it lets the ground show through, so the app reads as
 * panels laid on a surface instead of a browser window divided by lines. It
 * also means every edge is a radius, which suits a product about small
 * children rather than a trading terminal.
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireStaff();
  const supabase = await createClient();
  const [{ data: profile }, platform, logoUrl, support] = await Promise.all([
    supabase.from("kg_profiles").select("full_name").eq("id", ctx.user.id).single(),
    // The operator panel had no way in but typing the URL. Everyone else gets
    // nothing here, so the menu never hints that /admin exists.
    getPlatformContext(),
    // The crèche's own logo, not Rawdati's mark: staff spend their day in here
    // and it should look like their place of work.
    signedMediaUrl(ctx.tenant.logo_url),
    // Admins only — the vendor relationship is not an educator's business, and
    // the RPC returns null for anyone else anyway.
    ctx.isAdmin ? getSupportSummary(ctx.tenant.id) : Promise.resolve(null),
  ]);

  return (
    <div className="flex h-dvh gap-2 overflow-hidden bg-shell p-2 sm:gap-2.5 sm:p-2.5">
      <Sidebar role={ctx.role} tenantName={ctx.tenant.name} logoUrl={logoUrl} />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl bg-background shadow-sm ring-1 ring-border/70">
        <Topbar
          userId={ctx.user.id}
          userName={profile?.full_name || displayIdentity(ctx.user.email) || ""}
          roleLabel={ctx.membership.job_title ?? ctx.role}
          title={ctx.tenant.name}
          isPlatformAdmin={!!platform}
          role={ctx.role}
          tenantName={ctx.tenant.name}
          logoUrl={logoUrl}
        />
        <main className="flex-1 overflow-y-auto p-4 md:p-6">{children}</main>
        {support && (
          <SupportWidget
            tenantId={ctx.tenant.id}
            threadId={support.threadId}
            initialUnread={support.unread}
          />
        )}
      </div>
    </div>
  );
}
