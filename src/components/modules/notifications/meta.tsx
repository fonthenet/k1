// Visual vocabulary for a notification type. One icon + one token tint per
// type, shared by the topbar bell and the /notifications history so the same
// event always looks the same wherever it is read.

import {
  BabyIcon,
  BanknoteX,
  Bell,
  CalendarX2,
  ClipboardList,
  HeartPulse,
  ListChecks,
  LogIn,
  LogOut,
  Megaphone,
  MessageCircle,
  NotebookPen,
  ReceiptText,
  ShieldAlert,
  Sparkles,
  TriangleAlert,
  Undo2,
  UserPen,
  UserRoundCog,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

const ICONS: Record<string, LucideIcon> = {
  message: MessageCircle,
  incident: ShieldAlert,
  announcement: Megaphone,
  application: ClipboardList,
  checkin: LogIn,
  checkout: LogOut,
  daily_report: NotebookPen,
  task: ListChecks,
  activity_request: Sparkles,
  parent_update: UserPen,
  consent_changed: ShieldAlert,
  payment_overdue: BanknoteX,
  // 0049 — the family's side of every change to their child.
  pickup_changed: UserRoundCog,
  guardian_access_changed: Users,
  allergy_changed: TriangleAlert,
  health_changed: HeartPulse,
  incident_updated: ShieldAlert,
  enrollment_changed: BabyIcon,
  invoice_issued: ReceiptText,
  payment_recorded: Wallet,
  payment_reversed: Undo2,
  fee_changed: Wallet,
  attendance_flagged: CalendarX2,
  application_status: ClipboardList,
  activity_decision: Sparkles,
  session_published: NotebookPen,
};

// Tokens only. Gold tints take `gold-ink` for text — the raw gold hue is far
// too light to read on its own tint (see THEME.md).
const TONES: Record<string, string> = {
  message: "bg-primary/10 text-primary",
  incident: "bg-destructive/10 text-destructive",
  announcement: "bg-gold-muted text-gold-ink",
  application: "bg-gold-muted text-gold-ink",
  checkin: "bg-success/10 text-success",
  checkout: "bg-muted text-muted-foreground",
  parent_update: "bg-gold-muted text-gold-ink",
  consent_changed: "bg-gold-muted text-gold-ink",
  daily_report: "bg-primary/10 text-primary",
  task: "bg-primary/10 text-primary",
  // Money owed is a problem, not a neutral fact — same red as an incident.
  payment_overdue: "bg-destructive/10 text-destructive",
  activity_request: "bg-gold-muted text-gold-ink",
  // Custody and safety read as warnings; an allergy reads as an alarm. Money
  // that arrived is good news, money that moved back is not.
  pickup_changed: "bg-gold-muted text-gold-ink",
  guardian_access_changed: "bg-gold-muted text-gold-ink",
  allergy_changed: "bg-destructive/10 text-destructive",
  health_changed: "bg-gold-muted text-gold-ink",
  incident_updated: "bg-destructive/10 text-destructive",
  enrollment_changed: "bg-gold-muted text-gold-ink",
  invoice_issued: "bg-gold-muted text-gold-ink",
  payment_recorded: "bg-success/10 text-success",
  payment_reversed: "bg-destructive/10 text-destructive",
  fee_changed: "bg-gold-muted text-gold-ink",
  attendance_flagged: "bg-destructive/10 text-destructive",
  // The family's admissions result — big news, warm tone.
  application_status: "bg-gold-muted text-gold-ink",
  activity_decision: "bg-primary/10 text-primary",
  session_published: "bg-primary/10 text-primary",
};

/** The square icon tile that opens every notification row. */
export function NotificationIcon({ type, className }: { type: string; className?: string }) {
  const Icon = ICONS[type] ?? Bell;
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-xl",
        TONES[type] ?? "bg-muted text-muted-foreground",
        className
      )}
    >
      <Icon className="size-4" />
    </span>
  );
}
