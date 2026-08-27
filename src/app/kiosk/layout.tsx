import { KioskShell } from "@/components/modules/attendance/kiosk-shell";

// Fullscreen door-kiosk shell: no dashboard chrome. The theme follows the clock
// rather than the viewer — see KioskShell.
export default function KioskLayout({ children }: { children: React.ReactNode }) {
  return <KioskShell>{children}</KioskShell>;
}
