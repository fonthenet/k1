"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { ArrowRight, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PRINTABLE_KEYS, requirementName } from "@/lib/dossier";
import { listFormat } from "@/lib/format";

const EMOJI = ["🎉", "🎈", "🌟", "🎊", "✨", "🌈"];

export interface StepSuccessProps {
  tenantName: string;
  /** The uuid kg_submit_application returned; null when the RPC returned none, or when no paper was asked for — then no links render. */
  submittedId: string | null;
  /** The required papers of the kind with no file, in sort_order. */
  missing: ReadonlyArray<{ key: string; name: string; name_ar: string | null }>;
}

/** A tertiary link of the success screen: text-primary with a trailing chevron, no underline. */
function TertiaryLink({ href, children }: { href: string; children: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-0.5 text-sm text-primary">
      {children}
      <ChevronRight className="size-3.5 rtl:rotate-180" aria-hidden />
    </Link>
  );
}

export function StepSuccess({ tenantName, submittedId, missing }: StepSuccessProps) {
  const t = useTranslations("enroll");
  const locale = useLocale();

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

      {/* What is still to bring to the desk — one muted sentence, no list of
          red rows: a missing paper never blocked the application (D7), and
          the office reads the same names as "Manquante". */}
      {missing.length > 0 && (
        <p className="mt-4 max-w-sm text-sm text-pretty text-muted-foreground">
          {t("success.bring", {
            list: listFormat(locale).format(missing.map((m) => requirementName(m, locale))),
          })}
        </p>
      )}

      {/* The family's own file — valid before approval and after it, when
          the route redirects to the child's page (D12) — and the two sheets
          that stand in for a paper the establishment still asks for on
          paper: the fiche pre-filled with what they just typed, the
          handwritten request as a template. */}
      {submittedId && (
        <div className="mt-4 flex flex-col items-center gap-1.5">
          <TertiaryLink href={`/enroll/dossier/${submittedId}`}>{t("success.seeDossier")}</TertiaryLink>
          {missing.some((m) => m.key === PRINTABLE_KEYS.fiche) && (
            <TertiaryLink href={`/enroll/dossier/${submittedId}/print?sheet=fiche`}>
              {t("success.printFiche")}
            </TertiaryLink>
          )}
          {missing.some((m) => m.key === PRINTABLE_KEYS.demande) && (
            <TertiaryLink href={`/enroll/dossier/${submittedId}/print?sheet=demande`}>
              {t("success.printDemande")}
            </TertiaryLink>
          )}
        </div>
      )}

      {/* /after-login, not /portal. A first-time applicant has no membership
          yet — the office creates it on approval — so /portal bounced them
          through getTenantContext() straight onto the "create your
          kindergarten" founder wizard, the one screen a parent must never
          meet. /after-login already knows the three cases: staff go to the
          dashboard, a parent with a membership (a sibling enrolment) to their
          portal, and a family still waiting to the onboarding page that leads
          with their pending request. */}
      <Button asChild className="mt-8 h-12 w-full text-base" size="lg">
        <Link href="/after-login">
          {t("success.portal")}
          <ArrowRight className="size-4 rtl:rotate-180" data-icon="inline-end" />
        </Link>
      </Button>
    </div>
  );
}
