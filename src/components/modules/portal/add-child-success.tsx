"use client";

// The end of the sibling flow. It promises exactly what happened — a REQUEST
// was sent, not a place granted — and points the family at the one screen
// where they can watch it move: /portal/children, where the request now sits
// as a row until the office answers. When a required paper was not
// photographed, one muted sentence says which ones to bring to the desk
// (D7): the file never blocked the request, and the gate is where the
// paper comes.

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { ArrowRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { listFormat } from "@/lib/format";
import { requirementName } from "@/lib/dossier";
import { structureName, type Structure } from "@/components/modules/classes/class-types";

export function AddChildSuccess({
  tenantName,
  childName,
  structure = null,
  missing = [],
}: {
  tenantName: string;
  childName: string;
  /** The structure asked for, named in the message; null when there was one. */
  structure?: Structure | null;
  /** The required papers still to hand in, in the list's order. */
  missing?: ReadonlyArray<{ key: string; name: string; name_ar: string | null }>;
}) {
  const t = useTranslations("portal.addChild");
  const te = useTranslations("enroll");
  const locale = useLocale();

  return (
    <div className="flex flex-col items-center pt-8 text-center">
      <div
        className="mb-5 flex size-20 items-center justify-center rounded-full bg-primary/10 text-primary shadow-sm"
        aria-hidden
      >
        <Check className="size-9" strokeWidth={2.5} />
      </div>

      <h2 className="text-2xl font-bold tracking-tight">{t("success.title")}</h2>
      <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted-foreground">
        {structure
          ? t("success.messageStructure", {
              name: tenantName,
              child: childName,
              structure: structureName(structure, locale),
            })
          : t("success.message", { name: tenantName, child: childName })}
      </p>
      {/* The papers, as one sentence — not a list, not a warning. The
          portal's pending row is where the family completes the file from
          their phone; this screen only says what the desk will ask for. */}
      {missing.length > 0 && (
        <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted-foreground">
          {te("success.bring", {
            list: listFormat(locale).format(missing.map((m) => requirementName(m, locale))),
          })}
        </p>
      )}
      <p className="mt-2 text-xs text-muted-foreground">{t("success.hint")}</p>

      <Button asChild size="lg" className="mt-8 h-12 w-full text-base">
        <Link href="/portal/children">
          {t("success.back")}
          <ArrowRight className="size-4 rtl:rotate-180" data-icon="inline-end" />
        </Link>
      </Button>
    </div>
  );
}
