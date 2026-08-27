import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { CalendarClock, Target } from "lucide-react";
import { cn } from "@/lib/utils";

const TAB = {
  base: "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
  on: "bg-primary text-primary-foreground shadow-sm",
  off: "text-muted-foreground hover:text-foreground",
};

/** Sibling navigation between the two halves of the module: schedule ↔ programmes. */
export async function SessionsTabs({ active }: { active: "schedule" | "programs" }) {
  const t = await getTranslations("sessions");
  return (
    <nav className="inline-flex items-center rounded-lg border border-border bg-card p-0.5">
      <Link
        href="/sessions"
        aria-current={active === "schedule" ? "page" : undefined}
        className={cn(TAB.base, active === "schedule" ? TAB.on : TAB.off)}
      >
        <CalendarClock className="size-3.5" />
        {t("tabs.schedule")}
      </Link>
      <Link
        href="/sessions/programs"
        aria-current={active === "programs" ? "page" : undefined}
        className={cn(TAB.base, active === "programs" ? TAB.on : TAB.off)}
      >
        <Target className="size-3.5" />
        {t("tabs.programs")}
      </Link>
    </nav>
  );
}
