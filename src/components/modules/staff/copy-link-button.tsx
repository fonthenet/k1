"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function CopyLinkButton({ text }: { text: string }) {
  const t = useTranslations("staff");
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success(t("invites.copied"));
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t("errors.generic"));
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={copy}>
      {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
      {t("invites.copyLink")}
    </Button>
  );
}
