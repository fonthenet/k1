"use client";

import { useRef, useState, useTransition } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Camera, ChevronRight, ImageUp, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { addJournalPhoto, removeJournalPhoto } from "./journal-actions";

/*
 * The photos of one child's day.
 *
 * Opened from the camera in the journal row: the day's photos as tiles, a
 * remove on each that shows on hover and on focus, and the one primary verb
 * of the footer — add — beside the outline close. Photos travel only with
 * the family's consent (spec D9), so when it is missing or refused the dialog
 * opens in an explaining state — the sentence that says so and the door to
 * the child's consents — and offers no upload; the action checks the consent
 * again on the server, whatever this tab believed.
 */

/** Longest side after the client-side resize — a phone photo is 4000px and
 *  12 MB, a journal tile is 80px and a portal grid 160px. */
const MAX_DIMENSION = 1280;
/** Next's default server-action body limit; one file per call stays under it. */
const MAX_UPLOAD_BYTES = 1024 * 1024;

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new window.Image();
    img.onload = () => resolve(img);
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("decode failed"));
    };
    img.src = url;
  });
}

/**
 * Downscale to 1280px on the longest side and re-encode as JPEG. The canvas
 * routine of shared/photo-upload.tsx, copied because that file keeps it
 * private (a gap reported: PhotoUpload should export `resizeToJpeg`); a
 * second pass at a lower quality catches the rare picture still over the
 * body limit at 0.85.
 */
async function resizeImage(file: File): Promise<Blob> {
  const img = await loadImage(file);
  const scale = Math.min(1, MAX_DIMENSION / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas context");
  ctx.drawImage(img, 0, 0, w, h);
  URL.revokeObjectURL(img.src);
  const encode = (quality: number) =>
    new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode failed"))), "image/jpeg", quality)
    );
  const first = await encode(0.85);
  return first.size > MAX_UPLOAD_BYTES ? encode(0.7) : first;
}

const KNOWN_ERRORS = new Set(["future", "closed", "absent", "profile", "consent", "forbidden", "invalid"]);

export function JournalPhotos({
  childId,
  childName,
  date,
  photos,
  consent,
  disabled,
}: {
  childId: string;
  /** Already resolved for the reader's script. */
  childName: string;
  date: string;
  photos: { path: string; url: string | null }[];
  consent: "granted" | "refused" | "unanswered";
  /** Read-only: the tiles still open, nothing is added or removed. */
  disabled: boolean;
}) {
  const t = useTranslations("attendance.journal.photos");
  const tj = useTranslations("attendance.journal");
  const te = useTranslations("attendance.journal.errors");
  const ta = useTranslations("attendance");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [open, setOpen] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const canAdd = !disabled && consent === "granted";
  const errorToast = (error: string) =>
    toast.error(KNOWN_ERRORS.has(error) ? te(error) : ta("toasts.error"));

  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const list = Array.from(files);
    setProgress({ done: 0, total: list.length });
    let tooLarge = 0;
    let refused: string | null = null;
    for (const [i, file] of list.entries()) {
      try {
        const blob = await resizeImage(file);
        if (blob.size > MAX_UPLOAD_BYTES) {
          tooLarge++;
        } else {
          const fd = new FormData();
          fd.set("childId", childId);
          fd.set("date", date);
          fd.set("file", new File([blob], "photo.jpg", { type: "image/jpeg" }));
          const res = await addJournalPhoto(fd);
          // One refusal ends the batch: the reason (consent withdrawn, day
          // closed) holds for every file that follows.
          if (!res.ok) {
            refused = res.error;
            break;
          }
        }
      } catch {
        tooLarge++;
      }
      setProgress({ done: i + 1, total: list.length });
    }
    setProgress(null);
    if (inputRef.current) inputRef.current.value = "";
    if (refused) errorToast(refused);
    if (tooLarge > 0) toast.error(t("tooLarge"));
    router.refresh();
  };

  const remove = (path: string) => {
    setRemoving(path);
    startTransition(async () => {
      const res = await removeJournalPhoto({ childId, date, path });
      setRemoving(null);
      if (!res.ok) errorToast(res.error);
      else router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {/* The camera and a muted count — the row's one quiet control; nothing
            to open when the day is read-only and holds no photo. */}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled && photos.length === 0}
          aria-label={t("count", { count: photos.length })}
          title={tj("columns.photos")}
          className="gap-1.5 px-2 text-muted-foreground hover:text-foreground"
        >
          <Camera className="size-4" aria-hidden />
          <span className="text-xs tabular-nums" dir="ltr">{photos.length}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>
            {t.rich("title", {
              child: childName,
              date: formatDate(date, locale),
              name: (c) => <bdi dir="auto">{c}</bdi>,
            })}
          </DialogTitle>
          <DialogDescription>
            {consent === "granted"
              ? t("count", { count: photos.length })
              : consent === "refused"
                ? t("refused")
                : t("noConsent")}
          </DialogDescription>
        </DialogHeader>

        {consent !== "granted" && (
          <Link
            href={`/children/${childId}?tab=consents`}
            className="inline-flex w-fit items-center gap-1 text-sm text-primary"
          >
            {t("seeConsents")}
            <ChevronRight className="size-3.5 rtl:-scale-x-100" aria-hidden />
          </Link>
        )}

        {photos.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {photos.map((p) => (
              <li
                key={p.path}
                className={cn(
                  "group relative size-20 overflow-hidden rounded-lg bg-muted",
                  removing === p.path && "opacity-50"
                )}
              >
                {p.url && <Image src={p.url} alt="" fill sizes="80px" className="object-cover" />}
                {!disabled && (
                  <button
                    type="button"
                    aria-label={t("remove")}
                    title={t("remove")}
                    disabled={removing !== null}
                    onClick={() => remove(p.path)}
                    // Faded, never display:none — a hidden button leaves the
                    // tab order, and a keyboard could add photos but not remove one.
                    className="absolute end-1 top-1 flex size-6 items-center justify-center rounded-full bg-background/90 text-destructive opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                  >
                    <X className="size-3.5" aria-hidden />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        {canAdd && (
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            hidden
            onChange={(e) => void onFiles(e.target.files)}
          />
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            {tc("actions.close")}
          </Button>
          {canAdd && (
            <Button type="button" disabled={progress !== null} onClick={() => inputRef.current?.click()}>
              {progress ? (
                <Loader2 data-icon="inline-start" className="animate-spin" />
              ) : (
                <ImageUp data-icon="inline-start" />
              )}
              {progress ? (
                <span dir="ltr" className="tabular-nums">{progress.done} / {progress.total}</span>
              ) : (
                t("add")
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
