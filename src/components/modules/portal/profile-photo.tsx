"use client";

import { useTranslations } from "next-intl";
import { Camera } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { buildPhotoLabels, PhotoUpload } from "@/components/shared/photo-upload";
import { initials } from "@/lib/format";
import { removeMyGuardianPhoto, updateMyGuardianPhoto } from "./actions";

/**
 * The parent's own face. This is the door check's second factor: a QR code on
 * a phone screen can be photographed by anyone, so what actually keeps a child
 * safe is the member of staff comparing this photo with the adult in front of
 * them. The card says exactly that, in one line, so it never reads as vanity.
 *
 * The upload goes to `t/{tenant}/guardians/{my guardian id}/…`, the only place
 * migration 0021 lets a parent write. `guardianId` decides the folder; the
 * server action re-resolves the caller's own rows and refuses anything else.
 */
export function ProfilePhoto({
  tenantId,
  guardianId,
  name,
  firstName,
  lastName,
  photoPath,
  photoUrl,
}: {
  tenantId: string;
  guardianId: string;
  name: string;
  firstName: string;
  lastName: string;
  photoPath: string | null;
  photoUrl: string | null;
}) {
  const t = useTranslations("portal.profile");
  const tc = useTranslations("common");

  return (
    <Card>
      <CardHeader className="flex flex-row items-start gap-3">
        <span
          aria-hidden
          className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary [&>svg]:size-4"
        >
          <Camera />
        </span>
        <div className="grid gap-1">
          <CardTitle className="text-base font-semibold">{t("photo.title")}</CardTitle>
          <CardDescription className="leading-relaxed">{t("photo.description")}</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <PhotoUpload
          variant="inline"
          showHeading={false}
          pathPrefix={`t/${tenantId}/guardians/${guardianId}`}
          currentPath={photoPath}
          currentUrl={photoUrl}
          alt={name}
          fallback={initials(firstName, lastName)}
          onSave={(path) => updateMyGuardianPhoto(path)}
          onRemove={() => removeMyGuardianPhoto()}
          labels={buildPhotoLabels(t, tc)}
          avatarClassName="size-20 text-xl ring-1 ring-primary/15"
        />
      </CardContent>
    </Card>
  );
}
