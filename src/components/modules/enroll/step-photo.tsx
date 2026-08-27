"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Camera, Check, Images, Loader2, RefreshCw, UserRound } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { StepHeader } from "./wizard-ui";
import type { WizardUser } from "./types";

const MAX_DIMENSION = 800;

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

export function StepPhoto({
  user,
  photoPath,
  onUploaded,
}: {
  user: WizardUser | null;
  photoPath: string | null;
  onUploaded: (path: string) => void;
}) {
  const t = useTranslations("enroll");
  const supabase = useMemo(() => createClient(), []);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Resuming with a stored path but no local preview: fetch a signed URL (owner can read u/{uid}/...).
  useEffect(() => {
    let cancelled = false;
    if (photoPath && !preview) {
      supabase.storage
        .from("kg-media")
        .createSignedUrl(photoPath, 3600)
        .then(({ data }) => {
          if (!cancelled && data?.signedUrl) setPreview(data.signedUrl);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [photoPath, preview, supabase]);

  const handleFile = async (file: File | undefined) => {
    if (!file || !user) return;
    setError(null);
    setBusy(true);
    try {
      const blob = await resizeToJpeg(file);
      const path = `u/${user.id}/enroll/${crypto.randomUUID()}.jpg`;
      const { error: err } = await supabase.storage
        .from("kg-media")
        .upload(path, blob, { contentType: "image/jpeg" });
      if (err) {
        setError(t("photo.error"));
      } else {
        setPreview(URL.createObjectURL(blob));
        onUploaded(path);
      }
    } catch {
      setError(t("photo.error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <StepHeader icon={Camera} title={t("photo.title")} subtitle={t("photo.subtitle")} />

      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
      <input
        ref={galleryRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />

      <div className="flex flex-col items-center">
        <div className="mb-5 flex size-44 items-center justify-center overflow-hidden rounded-3xl border-2 border-dashed bg-card">
          {busy ? (
            <div className="flex flex-col items-center gap-2 text-muted-foreground">
              <Loader2 className="size-8 animate-spin" />
              <span className="text-xs">{t("photo.uploading")}</span>
            </div>
          ) : preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="" className="size-full object-cover" />
          ) : (
            <UserRound className="size-12 text-muted-foreground/40" aria-hidden />
          )}
        </div>

        {photoPath && !busy && (
          <p className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-primary">
            <Check className="size-4" />
            {t("photo.uploaded")}
          </p>
        )}

        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="grid w-full gap-3">
          <Button
            onClick={() => cameraRef.current?.click()}
            disabled={busy}
            className="h-12 w-full text-base"
            size="lg"
            variant={photoPath ? "outline" : "default"}
          >
            {photoPath ? <RefreshCw className="size-4" data-icon="inline-start" /> : <Camera className="size-4" data-icon="inline-start" />}
            {photoPath ? t("photo.retake") : t("photo.take")}
          </Button>
          <Button
            onClick={() => galleryRef.current?.click()}
            disabled={busy}
            variant="outline"
            className="h-12 w-full text-base"
            size="lg"
          >
            <Images className="size-4" data-icon="inline-start" />
            {t("photo.choose")}
          </Button>
        </div>

        <p className="mt-4 text-xs text-muted-foreground">{t("photo.skip")}</p>
      </div>
    </div>
  );
}
