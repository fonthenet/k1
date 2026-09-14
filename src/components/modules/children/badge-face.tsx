"use client";

import { QRCodeSVG } from "qrcode.react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

/**
 * The face of a door badge — what gets printed, without the page around it.
 *
 * One face for the three people the door meets. A child's badge wears the
 * class colour on its band so a stack of cards sorts itself on the desk; a
 * parent's and a colleague's wear the brand. The name leads in the reader's
 * script with the other script under it — the caller resolves both, as the
 * register does. The QR carries the printed code verbatim (kg_children
 * .tag_code, kg_guardians.tag_code or kg_memberships.staff_code) because that
 * exact string is what the kiosk resolves through kg_credentials.
 *
 * A PIN is never on a badge. It is the second factor, and a card that fell
 * out of a pocket must not carry both halves of the credential.
 *
 * Two sizes. `card` is the single badge a record page shows and prints on
 * its own — the visual the office already knows. `compact` is the CR80 card
 * (85.6 × 54 mm, landscape) the badges register lays out eight to an A4
 * sheet: sized in millimetres and set in ink on white whatever the theme, so
 * the printer gets exactly that.
 */
export interface BadgeFaceData {
  /** Leads the card, in the reader's script. */
  name: string;
  /** The other script, under the name; null when the person has only one. */
  altName: string | null;
  /** The avatar's fallback when there is no photo. */
  initials: string;
  photoUrl: string | null;
  /** Encoded verbatim in the QR and printed under it. */
  code: string;
  establishment: string;
  /** A child's class: the band colour and the chip. Null for adults. */
  klass: { name: string; color: string | null } | null;
  /** One muted line placing the person: a colleague's role, a parent's children. */
  line: string | null;
}

/**
 * The brand teal as ink. The compact card prints from either theme and the
 * dark theme's primary is a pale teal meant for dark surfaces, so the band of
 * an adult's card is pinned to the light theme's value rather than the token.
 */
const BRAND_INK = "#14788F";

/** Arabic letters anywhere in the string — the establishment's name is user data in either script. */
const ARABIC = /[\u0600-\u06FF]/;

/**
 * The band's text is set in the sheet's font, and a French sheet's font is
 * Latin: an Arabic establishment name in it loses the dots of ج and ي to the
 * band's height and reads as another word. The name carries Cairo itself
 * whenever it holds Arabic, whatever the sheet's language.
 */
function bandFont(text: string): string | undefined {
  return ARABIC.test(text) ? "font-[family-name:var(--font-cairo)]" : undefined;
}

/**
 * The ink for text on a band of a given colour. White carries about 2:1 on
 * the palette's amber, green and cyan — illegible at 7.5 pt on paper — so the
 * band's ink follows its relative luminance (WCAG): near-black on the light
 * colours, white on the dark ones. The threshold sits between the palette's
 * orange (0.33) and the blues and reds (≤ 0.25), where black already reads
 * better but white is still the look a badge is expected to have. A colour
 * that is not #rrggbb keeps white, the safe default for the brand and the
 * dark colours.
 */
function bandInk(color: string): "text-white" | "text-black/85" {
  const m = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return "text-white";
  const channel = (i: number) => {
    const c = parseInt(m[1].slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
  return luminance > 0.3 ? "text-black/85" : "text-white";
}

export function BadgeFace({
  data,
  variant = "card",
  hint,
  id,
  className,
}: {
  data: BadgeFaceData;
  variant?: "card" | "compact";
  /** The one-line instruction under the code; the single card shows it, the sheet has no room. */
  hint?: string;
  id?: string;
  className?: string;
}) {
  if (variant === "compact") return <CompactFace data={data} id={id} className={className} />;

  const classColor = data.klass?.color ?? null;

  return (
    <div
      id={id}
      className={cn(
        "overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-lg print:border-black/20 print:bg-white print:text-black print:shadow-none",
        className
      )}
    >
      {/* The band wears the class colour when there is one (kg_classes.color,
          user data) and the brand otherwise. */}
      <div
        className={cn(
          "px-5 py-3.5 text-center text-sm font-semibold tracking-wide uppercase",
          classColor ? bandInk(classColor) : "bg-primary text-primary-foreground"
        )}
        style={classColor ? { backgroundColor: classColor } : undefined}
      >
        <bdi dir="auto" className={bandFont(data.establishment)}>
          {data.establishment}
        </bdi>
      </div>
      <div className="flex flex-col items-center gap-3 px-6 py-7">
        <Avatar className="size-24 ring-2 ring-primary/20">
          {data.photoUrl && <AvatarImage src={data.photoUrl} alt="" />}
          <AvatarFallback className="bg-primary/10 text-2xl font-semibold text-primary print:bg-transparent print:text-black">
            {data.initials}
          </AvatarFallback>
        </Avatar>
        <div className="text-center">
          <div className="text-xl font-bold tracking-tight">
            <bdi dir="auto">{data.name}</bdi>
          </div>
          {data.altName && (
            <div className="text-base font-semibold text-muted-foreground print:text-black/70">
              <bdi dir="auto">{data.altName}</bdi>
            </div>
          )}
          {data.line && (
            <div className="mt-1 text-sm text-muted-foreground print:text-black/70">
              <bdi dir="auto">{data.line}</bdi>
            </div>
          )}
          {data.klass && (
            <div className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-0.5 text-xs font-medium print:border-black/20">
              <span
                className="size-2 rounded-full"
                style={{ backgroundColor: data.klass.color ?? "var(--primary)" }}
                aria-hidden
              />
              {data.klass.name}
            </div>
          )}
        </div>
        {/* The QR stays literal black-on-white: scanners need the contrast,
            and it must print correctly whatever the on-screen theme is. */}
        <div className="rounded-xl border border-border bg-white p-3 print:border-black/20">
          <QRCodeSVG value={data.code} size={160} marginSize={0} />
        </div>
        <div
          dir="ltr"
          className="rounded-md bg-muted px-3 py-1 font-mono text-sm font-semibold tracking-widest print:bg-transparent"
        >
          {data.code}
        </div>
        {hint && (
          <p className="text-center text-xs text-muted-foreground print:text-black/60">{hint}</p>
        )}
      </div>
    </div>
  );
}

/**
 * The CR80 card. Landscape: the band across the top, the person at the
 * inline start, the QR at the inline end, so the same face reads correctly
 * on a French and on an Arabic sheet. Black on white in both themes — this
 * is paper, and the hairline border is the cut line.
 */
function CompactFace({ data, id, className }: { data: BadgeFaceData; id?: string; className?: string }) {
  const bandColor = data.klass?.color ?? BRAND_INK;
  return (
    <div
      id={id}
      className={cn(
        "flex h-[54mm] w-[85.6mm] flex-col overflow-hidden rounded-[3mm] border border-black/25 bg-white text-black",
        className
      )}
    >
      {/* leading-normal, not leading-none: the band is 7 mm tall and the
          line box must leave room above and below the letters, or the dots
          of an Arabic name are cut off with the overflow. */}
      <div
        className={cn(
          "flex h-[7mm] shrink-0 items-center justify-center px-[3mm] text-[7.5pt] leading-normal font-semibold tracking-wide uppercase",
          bandInk(bandColor)
        )}
        style={{ backgroundColor: bandColor }}
      >
        <bdi dir="auto" className={cn("truncate", bandFont(data.establishment))}>
          {data.establishment}
        </bdi>
      </div>
      <div className="flex min-h-0 flex-1 items-center gap-[3mm] px-[3.5mm] py-[3mm]">
        <Avatar className="size-[15mm] shrink-0 after:border-black/15">
          {data.photoUrl && <AvatarImage src={data.photoUrl} alt="" />}
          <AvatarFallback className="bg-black/5 text-[11pt] font-semibold text-black">
            {data.initials}
          </AvatarFallback>
        </Avatar>
        {/* Each line is a block in the sheet's direction with the name
            isolated inline: the column then keeps one edge whichever script
            a line is in, instead of an Arabic line jumping to the far side
            of a French card. */}
        <div className="flex min-w-0 flex-1 flex-col gap-[1mm] text-start">
          <div className="truncate text-[10.5pt] leading-tight font-bold tracking-tight">
            <bdi dir="auto">{data.name}</bdi>
          </div>
          {data.altName && (
            <div className="truncate text-[8.5pt] leading-tight font-semibold text-black/70">
              <bdi dir="auto">{data.altName}</bdi>
            </div>
          )}
          {data.line && (
            <div className="line-clamp-2 text-[7pt] leading-snug text-black/60">
              <bdi dir="auto">{data.line}</bdi>
            </div>
          )}
          {data.klass && (
            <span className="inline-flex max-w-full items-center gap-[1.2mm] self-start rounded-full border border-black/20 px-[1.8mm] py-[0.6mm] text-[7pt] leading-tight font-medium">
              <span
                className="size-[1.8mm] shrink-0 rounded-full"
                style={{ backgroundColor: data.klass.color ?? BRAND_INK }}
                aria-hidden
              />
              <span className="truncate">{data.klass.name}</span>
            </span>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-center gap-[1.2mm]">
          {/* The SVG scales through its viewBox; the millimetre box is what
              the printer honours, the pixel size only seeds the drawing. */}
          <QRCodeSVG value={data.code} size={88} marginSize={0} className="size-[23mm]" />
          <span dir="ltr" className="font-mono text-[7pt] leading-none font-semibold tracking-wider">
            {data.code}
          </span>
        </div>
      </div>
    </div>
  );
}
