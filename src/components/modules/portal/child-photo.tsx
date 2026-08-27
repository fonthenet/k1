"use client";

import { useTranslations } from "next-intl";
import { buildPhotoLabels, PhotoUpload } from "@/components/shared/photo-upload";
import { initials } from "@/lib/format";
import { removeMyChildPhoto, setMyChildPhoto } from "./actions";

/**
 * The child's face on the parent's own file.
 *
 * This is the other half of the door check: staff scan the guardian's QR, then
 * compare two photos — the adult's and the child's — before letting anyone
 * leave with a child. The family has by far the better picture, so migration
 * 0023 gives them this one column and nothing else on `kg_children`.
 *
 * The avatar itself is the button (56px, well past the 44px floor) so the
 * header stays as compact as it was; the camera and file choices open in a
 * dialog where every control is 44px tall.
 */
export function ChildPhoto({
  tenantId,
  childId,
  name,
  firstName,
  lastName,
  photoPath,
  photoUrl,
}: {
  tenantId: string;
  childId: string;
  name: string;
  firstName: string;
  lastName: string;
  photoPath: string | null;
  photoUrl: string | null;
}) {
  const t = useTranslations("portal.child");
  const tc = useTranslations("common");

  /**
   * `kg_set_child_photo` raises three complaints by name and the actions turn
   * them into three codes, but `PhotoUpload` offers exactly two message slots —
   * "you may not" and "it did not work" — and that file is not ours to widen.
   * So `forbidden` (the only one a real family can trigger: their link to the
   * child was removed) gets its own line, and the other two — a path the server
   * refused, a file that has since been deleted — share one that says both
   * "try again" and "ask the office", because that is the honest advice for a
   * failure the parent cannot see the cause of.
   */
  return (
    <PhotoUpload
      variant="dialog"
      pathPrefix={`t/${tenantId}/children/${childId}`}
      currentPath={photoPath}
      currentUrl={photoUrl}
      alt={name}
      fallback={initials(firstName, lastName)}
      onSave={(path) => setMyChildPhoto({ childId, path })}
      onRemove={() => removeMyChildPhoto(childId)}
      labels={buildPhotoLabels(t, tc)}
      avatarClassName="size-14 ring-2 ring-gold/25"
    />
  );
}
