import { requireStaff } from "@/lib/tenant";
import { KioskClient } from "@/components/modules/attendance/kiosk-client";

export const dynamic = "force-dynamic";

// The door device is signed in as a staff account; the client kiosk gets the
// tenant from the server so every query/RPC is scoped correctly.
export default async function KioskPage() {
  const ctx = await requireStaff();
  return <KioskClient tenantId={ctx.tenant.id} tenantName={ctx.tenant.name} />;
}
