import { BabyIcon, DatabaseBackupIcon, LanguagesIcon, ShieldCheckIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { cn } from "@/lib/utils";
import { SECTION, TILE, type TileTone } from "./styles";

const ITEMS = [
  { id: "designed", icon: BabyIcon, tone: "sky" },
  { id: "decree", icon: ShieldCheckIcon, tone: "mint" },
  { id: "languages", icon: LanguagesIcon, tone: "amber" },
  { id: "backups", icon: DatabaseBackupIcon, tone: "pink" },
] as const satisfies readonly { id: string; icon: typeof BabyIcon; tone: TileTone }[];

/** Slim proof band that catches the hero's sky edge and cools it back to white. */
export async function TrustStrip() {
  const t = await getTranslations("landing.trust");

  return (
    <section className="border-b border-border bg-card">
      <div
        className={cn(
          SECTION,
          "grid gap-x-8 gap-y-7 py-8 sm:grid-cols-2 lg:grid-cols-4 lg:gap-x-0 lg:py-9"
        )}
      >
        {ITEMS.map((item) => (
          <div
            key={item.id}
            className="flex items-start gap-3 lg:border-s lg:border-border lg:px-7 lg:first:border-s-0 lg:first:ps-0 lg:last:pe-0"
          >
            <span
              className={cn(
                "grid size-10 shrink-0 place-items-center rounded-xl",
                TILE[item.tone]
              )}
            >
              <item.icon className="size-5" aria-hidden />
            </span>
            <span className="min-w-0">
              {/* Two-line box so every description starts on the same baseline,
                  however the title wraps in Arabic, English or French. */}
              <span className="block text-sm leading-snug font-bold text-balance text-foreground sm:min-h-[2.75em]">
                {t(`${item.id}.title`)}
              </span>
              <span className="mt-1 block text-xs leading-snug text-pretty text-muted-foreground">
                {t(`${item.id}.desc`)}
              </span>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
