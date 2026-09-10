"use client";

// The first question in a building with two structures: which one?
//
// Asked FIRST, before the child's name, because everything after it is
// scoped by the answer — the room proposed from the birth date, the tariff
// the office will attach, the register the child ends up on. A whole-building
// enrolment link asks the same question on the same cards (package C), so a
// family who used the public form once is on familiar ground. Never shown in
// a one-structure crèche: the wizard skips the step and the word "structure"
// does not appear.

import { useTranslations } from "next-intl";
import { Building2 } from "lucide-react";
import { StepHeader } from "@/components/modules/enroll/wizard-ui";
import type { Structure } from "@/components/modules/classes/class-types";
import type { PortalClassOption } from "./portal-types";
import { StructureChoice } from "./structure-choice";

export function AddChildStepStructure({
  structures,
  classes,
  value,
  onChange,
}: {
  structures: Structure[];
  classes: PortalClassOption[];
  value: string | null;
  onChange: (id: string) => void;
}) {
  const t = useTranslations("portal.addChild.structure");

  return (
    <div>
      <StepHeader icon={Building2} title={t("title")} subtitle={t("subtitle")} />
      <StructureChoice
        structures={structures}
        classes={classes}
        value={value}
        onChange={onChange}
        ariaLabel={t("title")}
      />
    </div>
  );
}
