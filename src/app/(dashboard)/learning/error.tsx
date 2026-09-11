"use client";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
export default function LearningError({ reset }: { reset: () => void }) {
  const t = useTranslations("learning");
  return (
    <div role="alert" className="space-y-4 rounded-xl border p-6">
      <p>{t("errors.failed")}</p>
      <Button onClick={reset}>{t("open")}</Button>
    </div>
  );
}
