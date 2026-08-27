import { requireStaff } from "@/lib/tenant";
import { SettingsNav } from "@/components/modules/settings/settings-nav";

/**
 * Shell for every settings page. The admin section nav is hidden for non-admin
 * staff, who only reach /settings/profile (from the topbar user menu).
 */
export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireStaff();

  return (
    <div className="mx-auto w-full max-w-5xl">
      {ctx.isAdmin && (
        <div className="print:hidden">
          <SettingsNav />
        </div>
      )}
      {children}
    </div>
  );
}
