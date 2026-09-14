import { requireStaff } from "@/lib/tenant";
import { KioskClient } from "@/components/modules/attendance/kiosk-client";
import { kioskSettings } from "@/lib/kiosk-settings";

export const dynamic = "force-dynamic";

// The door device is signed in as a staff account; the client kiosk gets the
// tenant from the server so every query/RPC is scoped correctly. The door's
// settings come the same way — read here once, then re-read by the client
// every minute, because the tablet never reloads this page on its own.
export default async function KioskPage() {
  const ctx = await requireStaff();
  return (
    <KioskClient
      tenantId={ctx.tenant.id}
      tenantName={ctx.tenant.name}
      settings={kioskSettings(ctx.tenant.settings)}
    />
  );
}
