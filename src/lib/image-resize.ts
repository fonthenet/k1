// Browser-side image downscaling, shared by the photo step (800 px, a face
// on a badge) and the dossier upload control (1600 px, a legible A4 scan).
//
// Lifted out of step-photo.tsx in 0164 so the two uploads re-encode the same
// way: through a canvas, to JPEG. The canvas is what makes a family's phone
// photo safe to hand to the register — iOS Safari decodes HEIC into it, so
// the object that reaches Storage is a JPEG whatever the camera wrote, and a
// 4 MB shot of an extrait de naissance leaves the phone at a few hundred KB.
//
// DOM only: Image, canvas and object URLs exist in the browser alone, so
// only client components import this file.

export function loadImage(file: File): Promise<HTMLImageElement> {
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

/**
 * Downscale so the longest side is at most `maxPx` and re-encode as JPEG.
 * Rejects when the browser cannot decode the file (a HEIC on a desktop
 * browser, a file that is not an image at all); the caller decides what to
 * send instead.
 */
export async function resizeToJpeg(file: File, maxPx: number, quality = 0.85): Promise<Blob> {
  const img = await loadImage(file);
  const scale = Math.min(1, maxPx / Math.max(img.naturalWidth, img.naturalHeight));
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
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode failed"))), "image/jpeg", quality)
  );
}
