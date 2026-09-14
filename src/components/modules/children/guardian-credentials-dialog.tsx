"use client";

import { useTranslations } from "next-intl";
import { IssuedPinDialog } from "@/components/modules/credentials/issued-pin-dialog";
import type { IssuedCredentials } from "./guardian-credentials-actions";

/**
 * The guardian's PIN, shown once. The display itself is the shared
 * IssuedPinDialog — the same number, the same warning, wherever a PIN is
 * handed over — dressed here in the guardian's words: a badge was issued, the
 * printed code beside the PIN is the tag the QR carries, and the badge page
 * is one click away.
 */
export function GuardianCredentialsDialog({
  childId,
  guardianId,
  credentials,
  onClose,
}: {
  childId: string;
  guardianId: string;
  credentials: IssuedCredentials | null;
  onClose: () => void;
}) {
  const t = useTranslations("children");

  return (
    <IssuedPinDialog
      issued={credentials ? { pinCode: credentials.pinCode, code: credentials.tagCode } : null}
      onClose={onClose}
      title={t("guardians.credentials.issuedTitle")}
      description={t("guardians.credentials.issuedDescription", {
        name: credentials?.guardianName ?? "",
      })}
      warning={t("guardians.credentials.pinWarning")}
      codeLabel={t("guardians.credentials.tagLabel")}
      printHref={`/children/${childId}/guardian/${guardianId}/badge`}
    />
  );
}
