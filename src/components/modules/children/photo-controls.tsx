"use client";

import { useTranslations } from "next-intl";
import { buildPhotoLabels, PhotoUpload } from "@/components/shared/photo-upload";
import { initials } from "@/lib/format";
import {
  clearChildPhoto,
  clearGuardianPhoto,
  setChildPhoto,
  setGuardianPhoto,
} from "./actions";

/**
 * Staff-side photo capture. Both controls use the dialog variant: on a busy
 * roster page the avatar itself is the button, and the camera / file choices
 * open in a dialog where every target clears 44px.
 */

export function ChildPhotoControl({
  tenantId,
  childId,
  name,
  firstName,
  lastName,
  photoPath,
  photoUrl,
  className,
  avatarClassName,
}: {
  tenantId: string;
  childId: string;
  name: string;
  firstName: string;
  lastName: string;
  photoPath: string | null;
  photoUrl: string | null;
  className?: string;
  avatarClassName?: string;
}) {
  const t = useTranslations("children");
  const tc = useTranslations("common");

  return (
    <PhotoUpload
      variant="dialog"
      pathPrefix={`t/${tenantId}/children/${childId}`}
      currentPath={photoPath}
      currentUrl={photoUrl}
      alt={name}
      fallback={initials(firstName, lastName)}
      onSave={(path) => setChildPhoto(childId, path)}
      onRemove={() => clearChildPhoto(childId)}
      labels={buildPhotoLabels(t, tc, {
        title: t("photo.childTitle"),
        description: t("photo.childDescription"),
      })}
      className={className}
      avatarClassName={avatarClassName}
    />
  );
}

export function GuardianPhotoControl({
  tenantId,
  guardianId,
  childId,
  name,
  firstName,
  lastName,
  photoPath,
  photoUrl,
}: {
  tenantId: string;
  guardianId: string;
  /** Only used to revalidate the child page this control was rendered on. */
  childId: string;
  name: string;
  firstName: string;
  lastName: string;
  photoPath: string | null;
  photoUrl: string | null;
}) {
  const t = useTranslations("children");
  const tc = useTranslations("common");

  return (
    <PhotoUpload
      variant="dialog"
      pathPrefix={`t/${tenantId}/guardians/${guardianId}`}
      currentPath={photoPath}
      currentUrl={photoUrl}
      alt={name}
      fallback={initials(firstName, lastName)}
      onSave={(path) => setGuardianPhoto(guardianId, path, childId)}
      onRemove={() => clearGuardianPhoto(guardianId, childId)}
      labels={buildPhotoLabels(t, tc, {
        title: t("photo.guardianTitle"),
        description: t("photo.guardianDescription"),
      })}
      avatarClassName="size-12"
    />
  );
}
