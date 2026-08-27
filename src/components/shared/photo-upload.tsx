"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, ImageUp, Loader2, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

/* -------------------------------------------------------------------------
   Photo capture — the second factor of the door check.

   A QR code on a phone screen can be photographed by anyone, so the only
   thing that makes hand-over safe is a human comparing the adult at the door
   with the face on file. That is why this control exists on the child header,
   on every guardian row, and in the parent's own profile: without photos the
   kiosk has nothing to verify against.

   The upload itself is client-side (bucket `kg-media`, RLS decides who may
   write where — see migration 0021). The caller-supplied server action then
   records the resulting path on the row and drops the file it replaced.
------------------------------------------------------------------------- */

const MAX_DIMENSION = 800;
/** Anything larger than this never reaches the canvas — phones shoot big. */
const MAX_INPUT_BYTES = 20 * 1024 * 1024;

export type PhotoUploadResult = { ok: true } | { ok: false; error?: string };

export interface PhotoUploadLabels {
  /** Dialog heading (dialog variant) / section heading (inline variant). */
  title: string;
  description: string;
  take: string;
  choose: string;
  replace: string;
  remove: string;
  removeTitle: string;
  removeDescription: string;
  cancel: string;
  confirm: string;
  resizing: string;
  uploading: string;
  saving: string;
  saved: string;
  removed: string;
  tooLarge: string;
  forbidden: string;
  error: string;
  /** Announced on the avatar while there is no photo on file. */
  none: string;
}

/**
 * Builds the label bundle from a module namespace: every key lives under
 * `prefix` in that namespace, except Cancel/Confirm which come from `common`.
 * `title`/`description` can be overridden so one `photo.*` block can serve
 * several subjects (a child, a guardian) without duplicating fifteen strings.
 */
export function buildPhotoLabels(
  t: (key: string) => string,
  tc: (key: string) => string,
  options: { prefix?: string; title?: string; description?: string } = {}
): PhotoUploadLabels {
  const p = options.prefix ?? "photo.";
  return {
    title: options.title ?? t(`${p}title`),
    description: options.description ?? t(`${p}description`),
    take: t(`${p}take`),
    choose: t(`${p}choose`),
    replace: t(`${p}replace`),
    remove: t(`${p}remove`),
    removeTitle: t(`${p}removeTitle`),
    removeDescription: t(`${p}removeDescription`),
    cancel: tc("actions.cancel"),
    confirm: tc("actions.confirm"),
    resizing: t(`${p}resizing`),
    uploading: t(`${p}uploading`),
    saving: t(`${p}saving`),
    saved: t(`${p}saved`),
    removed: t(`${p}removed`),
    tooLarge: t(`${p}tooLarge`),
    forbidden: t(`${p}forbidden`),
    error: t(`${p}error`),
    none: t(`${p}none`),
  };
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("decode failed"));
    };
    img.src = url;
  });
}

/** Downscale to max 800px on the longest side and re-encode as JPEG. */
async function resizeToJpeg(file: File): Promise<Blob> {
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
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode failed"))), "image/jpeg", 0.85)
  );
}

/** Upload has no byte-level progress in supabase-js, so progress is phase-based. */
type Phase = "idle" | "resizing" | "uploading" | "saving" | "removing";

const PHASE_PROGRESS: Record<Exclude<Phase, "idle">, number> = {
  resizing: 25,
  uploading: 65,
  saving: 90,
  removing: 60,
};

export interface PhotoUploadProps {
  /** Storage prefix without a trailing slash, e.g. `t/{tenantId}/guardians/{guardianId}`. */
  pathPrefix: string;
  /** Current `photo_path` on the row — decides whether "remove" is offered. */
  currentPath: string | null;
  /** Signed URL for `currentPath`, resolved on the server. */
  currentUrl: string | null;
  /** Alt text / accessible name for the image (the person's name). */
  alt: string;
  /** Initials shown while there is no photo. */
  fallback: string;
  /** Persist the freshly uploaded path on the row. */
  onSave: (path: string) => Promise<PhotoUploadResult>;
  /** Clear the row's photo and drop the stored object. */
  onRemove: () => Promise<PhotoUploadResult>;
  labels: PhotoUploadLabels;
  /**
   * `dialog` — the avatar itself is the button and the controls open in a
   * dialog (dense staff screens). `inline` — controls always visible (the
   * parent portal, where taking the photo is the point of the section).
   */
  variant?: "dialog" | "inline";
  /** Inline variant only: drop the title/description when a Card already says it. */
  showHeading?: boolean;
  avatarClassName?: string;
  className?: string;
  disabled?: boolean;
}

export function PhotoUpload({
  pathPrefix,
  currentPath,
  currentUrl,
  alt,
  fallback,
  onSave,
  onRemove,
  labels,
  variant = "inline",
  showHeading = true,
  avatarClassName,
  className,
  disabled = false,
}: PhotoUploadProps) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  /**
   * The write lands before `router.refresh()` brings a new signed URL back, so
   * we show the local blob in between. `base` records the server path the local
   * value was taken against: the moment the server catches up (`currentPath`
   * changes) the local value is stale by definition and we drop back to props —
   * no effect, no cascading render.
   */
  const [local, setLocal] = useState<{ base: string | null; url: string | null } | null>(null);
  const blobUrls = useRef<string[]>([]);

  // Blob URLs must not outlive the component.
  useEffect(
    () => () => {
      for (const url of blobUrls.current) URL.revokeObjectURL(url);
      blobUrls.current = [];
    },
    []
  );

  const fresh = local && local.base === currentPath ? local : null;
  const shownUrl = fresh ? fresh.url : currentUrl;
  const hasPhoto = fresh ? fresh.url !== null : Boolean(currentPath);
  const activePhase: Exclude<Phase, "idle"> | null = phase === "idle" ? null : phase;
  const busy = activePhase !== null;

  async function handleFile(file: File | undefined) {
    if (!file || busy || disabled) return;
    setError(null);
    if (file.size > MAX_INPUT_BYTES) {
      setError(labels.tooLarge);
      toast.error(labels.tooLarge);
      return;
    }

    let blob: Blob;
    setPhase("resizing");
    try {
      blob = await resizeToJpeg(file);
    } catch {
      setPhase("idle");
      setError(labels.error);
      toast.error(labels.error);
      return;
    }

    const path = `${pathPrefix}/photo-${crypto.randomUUID()}.jpg`;
    setPhase("uploading");
    const { error: upErr } = await supabase.storage
      .from("kg-media")
      .upload(path, blob, { contentType: "image/jpeg" });
    if (upErr) {
      setPhase("idle");
      // Distinguish "you may not write here" (a storage policy said no) from a
      // plain failure — the two need very different things from the user.
      const status = String((upErr as { statusCode?: string | number }).statusCode ?? "");
      const denied =
        status === "403" || /unauthorized|row-level security|violates/i.test(upErr.message);
      const message = denied ? labels.forbidden : labels.error;
      setError(message);
      toast.error(message);
      return;
    }

    setPhase("saving");
    const res = await onSave(path);
    setPhase("idle");
    if (!res.ok) {
      // The row was not updated — do not leave the orphan behind.
      await supabase.storage.from("kg-media").remove([path]);
      const message = res.error === "forbidden" ? labels.forbidden : labels.error;
      setError(message);
      toast.error(message);
      return;
    }

    const previewUrl = URL.createObjectURL(blob);
    blobUrls.current.push(previewUrl);
    setLocal({ base: currentPath, url: previewUrl });
    toast.success(labels.saved);
    setOpen(false);
    router.refresh();
  }

  async function handleRemove() {
    if (busy || disabled) return;
    setError(null);
    setPhase("removing");
    const res = await onRemove();
    setPhase("idle");
    if (!res.ok) {
      const message = res.error === "forbidden" ? labels.forbidden : labels.error;
      setError(message);
      toast.error(message);
      return;
    }
    setLocal({ base: currentPath, url: null });
    toast.success(labels.removed);
    setOpen(false);
    router.refresh();
  }

  const avatar = (
    <Avatar className={cn("size-16 ring-1 ring-border", avatarClassName)}>
      {shownUrl && <AvatarImage src={shownUrl} alt={alt} />}
      <AvatarFallback className="bg-primary/10 font-semibold text-primary">
        {fallback || "•"}
      </AvatarFallback>
    </Avatar>
  );

  const inputs = (
    <>
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="user"
        className="hidden"
        onChange={(e) => {
          void handleFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <input
        ref={galleryRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          void handleFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </>
  );

  const status = activePhase ? (
    <div className="grid gap-1.5" aria-live="polite">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 aria-hidden className="size-4 animate-spin" />
        <span>{labels[activePhase === "removing" ? "saving" : activePhase]}</span>
      </div>
      <Progress value={PHASE_PROGRESS[activePhase]} />
    </div>
  ) : error ? (
    <p className="flex items-start gap-2 text-sm text-destructive" role="alert">
      <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
      {error}
    </p>
  ) : null;

  const controls = (
    <div className="grid gap-2">
      <Button
        type="button"
        onClick={() => cameraRef.current?.click()}
        disabled={busy || disabled}
        variant={hasPhoto ? "outline" : "default"}
        className="h-11 w-full justify-center text-sm"
      >
        <Camera data-icon="inline-start" />
        {hasPhoto ? labels.replace : labels.take}
      </Button>
      <Button
        type="button"
        onClick={() => galleryRef.current?.click()}
        disabled={busy || disabled}
        variant="outline"
        className="h-11 w-full justify-center text-sm"
      >
        <ImageUp data-icon="inline-start" />
        {labels.choose}
      </Button>
      {hasPhoto && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              type="button"
              variant="destructive"
              disabled={busy || disabled}
              className="h-11 w-full justify-center text-sm"
            >
              <Trash2 data-icon="inline-start" />
              {labels.remove}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{labels.removeTitle}</AlertDialogTitle>
              <AlertDialogDescription>{labels.removeDescription}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{labels.cancel}</AlertDialogCancel>
              <AlertDialogAction onClick={() => void handleRemove()}>
                {labels.confirm}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );

  if (variant === "inline") {
    return (
      <div className={cn("grid gap-3", className)}>
        {inputs}
        <div className="flex items-center gap-4">
          {avatar}
          {showHeading ? (
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{labels.title}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                {labels.description}
              </p>
            </div>
          ) : !hasPhoto ? (
            <p className="min-w-0 flex-1 text-xs leading-relaxed text-muted-foreground">
              {labels.none}
            </p>
          ) : null}
        </div>
        {status}
        {controls}
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && setOpen(v)}>
      {inputs}
      <DialogTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={hasPhoto ? labels.replace : labels.take}
          className={cn(
            "group relative inline-flex shrink-0 rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
            className
          )}
        >
          {avatar}
          <span
            aria-hidden
            className="absolute -bottom-0.5 -end-0.5 flex size-6 items-center justify-center rounded-full border-2 border-background bg-primary text-primary-foreground transition-colors group-hover:bg-primary/80 [&>svg]:size-3"
          >
            {busy ? <Loader2 className="animate-spin" /> : <Camera />}
          </span>
          {!hasPhoto && <span className="sr-only">{labels.none}</span>}
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{labels.title}</DialogTitle>
          <DialogDescription className="leading-relaxed">{labels.description}</DialogDescription>
        </DialogHeader>
        <div className="flex justify-center py-1">
          <Avatar className="size-32 ring-1 ring-border">
            {shownUrl && <AvatarImage src={shownUrl} alt={alt} />}
            <AvatarFallback className="bg-primary/10 text-2xl font-semibold text-primary">
              {fallback || "•"}
            </AvatarFallback>
          </Avatar>
        </div>
        {status}
        {controls}
      </DialogContent>
    </Dialog>
  );
}
