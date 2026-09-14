"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { FileText, Loader2, Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import {
  DOCUMENT_IMAGE_MAX_PX,
  MAX_DOCUMENT_BYTES,
  acceptAttr,
  documentUploadPath,
  type DocumentAccepts,
  type WizardDocument,
} from "@/lib/dossier";
import { resizeToJpeg } from "@/lib/image-resize";

/* -------------------------------------------------------------------------
   One paper of the dossier d'inscription, from the family's side.

   The same control sits on the public wizard's dossier step, on the sibling
   wizard of the portal, on the child's portal page and on the family's
   pending file: it uploads ONE file into the folder the caller names and
   hands back the stored path. It never talks to the register — the wizard
   sends the paths with the application, the portal pages call their own
   attach action — so the register is written in one place per screen.

   ONE outline "Ajouter" button and one hidden <input type=file> with no
   `capture` attribute (D16): iOS and Android open their own sheet offering
   the camera, the library and the files app, so a second "Photographier"
   button, a drop zone or a camera plugin would only duplicate what the OS
   already does — nine rows times two buttons was the whole step. With a
   file: a 48 px thumbnail (or a PDF tile), the file name and one ghost
   "Changer". Replacing uploads to a fresh path and leaves the old object
   where it is: the register keeps history (D8) and nothing here may delete.

   Errors go to `onError`, never inline: the caller owns one Alert for the
   whole list, so a failed row is not a red frame among nine quiet ones.
------------------------------------------------------------------------- */

export type DocumentUploadError = "tooLarge" | "type" | "upload";

export interface DocumentUploadProps {
  /** Only used for the input's id; the control never talks to the DB. */
  requirementId: string;
  /**
   * The paper's name in the reader's language (requirementName). Nine rows
   * are nine identical "Ajouter" buttons to a screen reader; the name joins
   * each button's and the input's accessible name so the extrait can be
   * told from the carnet. Sighted readers see the row's own title.
   */
  label: string;
  accepts: DocumentAccepts;
  /** Folder the browser uploads into — see documentUploadPath. */
  pathPrefix: string;
  /** The current file, or null → the outline "Ajouter". */
  value: WizardDocument | null;
  /** Fires AFTER the upload succeeded with the stored path. */
  onChange: (doc: WizardDocument) => void;
  /** The CALLER renders it in its own Alert (common.dossier.errors.*). */
  onError: (error: DocumentUploadError) => void;
  disabled?: boolean;
  /** A signed URL the page already minted for `value.path`; without it an image is re-signed on mount. */
  previewUrl?: string | null;
}

/** A blob URL or a signed URL, remembered with the path it draws, so a replaced file never shows the old picture. */
type Preview = { path: string; url: string };

/**
 * What the file claims to be. Some browsers hand over an empty `type` for
 * a file picked from the files app, so the extension is the fallback; the
 * bytes are re-encoded (images) or sniffed by the server (staff scans)
 * before anything trusts this.
 */
function declaredMime(file: File): string {
  if (file.type) return file.type;
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  if (ext === "pdf") return "application/pdf";
  if (["jpg", "jpeg", "png", "webp", "heic", "heif"].includes(ext)) return `image/${ext}`;
  return "";
}

export function DocumentUpload({
  requirementId,
  label,
  accepts,
  pathPrefix,
  value,
  onChange,
  onError,
  disabled = false,
  previewUrl = null,
}: DocumentUploadProps) {
  const t = useTranslations("common.dossier");
  const supabase = useMemo(() => createClient(), []);
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  /** The picture of the file just uploaded, drawn from the blob itself. */
  const [local, setLocal] = useState<Preview | null>(null);
  /** The picture of a file restored from a draft, signed on mount. */
  const [signed, setSigned] = useState<Preview | null>(null);
  /** A path the browser could not draw — a raw HEIC it sent as it was. The tile stands in. */
  const [broken, setBroken] = useState<string | null>(null);

  const isImage = value !== null && value.mime !== "application/pdf";
  const preview =
    value === null || broken === value.path
      ? null
      : local?.path === value.path
        ? local.url
        : (previewUrl ?? (signed?.path === value.path ? signed.url : null));

  // A draft resumed on the same phone holds the path but no picture: the
  // family may read its own folder, so a signed URL is the way to draw it
  // (the photo step's idiom). Nothing to sign for a PDF — the tile says it.
  useEffect(() => {
    if (!value || !isImage || preview || broken === value.path) return;
    let cancelled = false;
    const path = value.path;
    supabase.storage
      .from("kg-media")
      .createSignedUrl(path, 3600)
      .then(({ data }) => {
        if (!cancelled && data?.signedUrl) setSigned({ path, url: data.signedUrl });
      });
    return () => {
      cancelled = true;
    };
  }, [value, isImage, preview, broken, supabase]);

  // Blob URLs are released when they stop being shown, and on unmount.
  useEffect(() => {
    return () => {
      if (local) URL.revokeObjectURL(local.url);
    };
  }, [local]);

  const handleFile = async (file: File | undefined) => {
    if (!file || busy || disabled) return;
    if (file.size > MAX_DOCUMENT_BYTES) {
      onError("tooLarge");
      return;
    }
    const claimed = declaredMime(file);
    const pdf = claimed === "application/pdf";
    const image = claimed.startsWith("image/");
    // Told now, not by the RPC after the upload: a photo where the
    // requirement wants the signed PDF is the one mistake a family makes.
    if ((!pdf && !image) || (accepts === "pdf" && !pdf) || (accepts === "image" && !image)) {
      onError("type");
      return;
    }

    setBusy(true);
    try {
      let blob: Blob = file;
      let mime = claimed;
      if (image) {
        // The canvas is what turns a 4 MB phone shot — or an iPhone's HEIC,
        // which Safari decodes — into a JPEG the office can open anywhere.
        // A browser that cannot decode the picture sends the bytes as they
        // are; they passed the size check, and the office's viewer decides.
        try {
          blob = await resizeToJpeg(file, DOCUMENT_IMAGE_MAX_PX);
          mime = "image/jpeg";
        } catch {
          blob = file;
        }
      }
      const path = documentUploadPath(pathPrefix, mime);
      const { error } = await supabase.storage.from("kg-media").upload(path, blob, { contentType: mime });
      if (error) {
        onError("upload");
        return;
      }
      if (mime === "image/jpeg") setLocal({ path, url: URL.createObjectURL(blob) });
      onChange({ path, file_name: file.name.slice(0, 120), mime });
    } catch {
      onError("upload");
    } finally {
      setBusy(false);
      // Cleared so choosing the same file again — after a failed upload,
      // say — fires a change event.
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const input = (
    <input
      ref={inputRef}
      id={`document-${requirementId}`}
      type="file"
      aria-label={label}
      accept={acceptAttr(accepts)}
      className="hidden"
      disabled={disabled || busy}
      onChange={(e) => handleFile(e.target.files?.[0])}
    />
  );

  const busyMark = (
    <span className="inline-flex h-9 items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" aria-hidden />
      {t("uploading")}
    </span>
  );

  if (value === null) {
    return (
      <>
        {input}
        {busy ? (
          busyMark
        ) : (
          <Button
            type="button"
            variant="outline"
            size="lg"
            disabled={disabled}
            aria-label={`${t("add")} · ${label}`}
            onClick={() => inputRef.current?.click()}
          >
            <Paperclip className="size-4" data-icon="inline-start" />
            {t("add")}
          </Button>
        )}
      </>
    );
  }

  return (
    <div className="flex min-w-0 items-center gap-3">
      {input}
      {isImage && preview ? (
        // eslint-disable-next-line @next/next/no-img-element -- a blob or a signed URL, gone within the hour
        <img
          src={preview}
          alt=""
          width={48}
          height={48}
          className="size-12 shrink-0 rounded-lg bg-muted object-cover"
          onError={() => setBroken(value.path)}
        />
      ) : (
        <span
          className="flex size-12 shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg bg-muted text-muted-foreground"
          aria-hidden
        >
          <FileText className="size-4.5" />
          {!isImage && <span className="text-[10px] leading-none font-medium">{t("pdf")}</span>}
        </span>
      )}
      <bdi dir="auto" className="min-w-0 flex-1 truncate text-start text-sm">
        {value.file_name}
      </bdi>
      {busy ? (
        busyMark
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="shrink-0"
          disabled={disabled}
          aria-label={`${t("change")} · ${label}`}
          onClick={() => inputRef.current?.click()}
        >
          {t("change")}
        </Button>
      )}
    </div>
  );
}
