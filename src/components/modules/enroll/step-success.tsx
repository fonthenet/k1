"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

const EMOJI = ["🎉", "🎈", "🌟", "🎊", "✨", "🌈"];

export function StepSuccess({ tenantName }: { tenantName: string }) {
  const t = useTranslations("enroll");

  // Generated after mount rather than during render: Math.random() makes a
  // render non-idempotent, and the confetti is decoration that nothing depends
  // on, so it can simply appear on the next frame.
  const [confetti, setConfetti] = useState<
    { emoji: string; left: number; delay: number; duration: number; size: number }[]
  >([]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- decoration only
    setConfetti(
      Array.from({ length: 18 }, (_, i) => ({
        emoji: EMOJI[i % EMOJI.length],
        left: Math.random() * 100,
        delay: Math.random() * 2.5,
        duration: 3 + Math.random() * 3,
        size: 16 + Math.random() * 14,
      }))
    );
  }, []);

  return (
    <div className="relative flex flex-col items-center pt-10 text-center">
      <style>{`
        @keyframes kg-confetti-fall {
          0% { transform: translateY(-10vh) rotate(0deg); opacity: 1; }
          100% { transform: translateY(80vh) rotate(360deg); opacity: 0; }
        }
      `}</style>
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        {confetti.map((c, i) => (
          <span
            key={i}
            className="absolute top-0"
            style={{
              insetInlineStart: `${c.left}%`,
              fontSize: `${c.size}px`,
              animation: `kg-confetti-fall ${c.duration}s linear ${c.delay}s infinite`,
            }}
          >
            {c.emoji}
          </span>
        ))}
      </div>

      <div className="mb-5 flex size-24 items-center justify-center rounded-full bg-primary/10 text-6xl shadow-sm" aria-hidden>
        🎉
      </div>
      <h1 className="text-2xl font-bold tracking-tight">{t("success.title")}</h1>
      <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted-foreground">
        {t("success.message", { name: tenantName })}
      </p>
      <p className="mt-2 text-xs text-muted-foreground">{t("success.hint")}</p>

      <Button asChild className="mt-8 h-12 w-full text-base" size="lg">
        <Link href="/portal">
          {t("success.portal")}
          <ArrowRight className="size-4 rtl:rotate-180" data-icon="inline-end" />
        </Link>
      </Button>
    </div>
  );
}
