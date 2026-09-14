"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ChevronRight, Nfc } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { SectionCard } from "@/components/shared/section-card";
import { ReaderTest } from "@/components/modules/credentials/reader-test";
import {
  CODE_LENGTH_MAX, CODE_LENGTH_MIN, TAG_TYPES, type BadgeSettings, type TagType,
} from "@/lib/badge-settings";
import { updateBadgeSettings, type BadgeSettingsPatch } from "./badges-settings-actions";

/**
 * The typed length as the database will hold it: null for an empty field, a
 * whole number inside the CHECK's bounds, or undefined for anything else —
 * the field then wears aria-invalid and nothing is sent.
 */
function parseLength(text: string): number | null | undefined {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  if (!/^[0-9]+$/.test(trimmed)) return undefined;
  const n = Number(trimmed);
  return n >= CODE_LENGTH_MIN && n <= CODE_LENGTH_MAX ? n : undefined;
}

/**
 * The reader and the badges it reads: which kind of tag the establishment
 * bought, how long its numbers are, and when the reader was last seen
 * working.
 *
 * Two fields, no Save. Each change saves itself — the select on change, the
 * length when the field is left or Enter is pressed — because the page's one
 * primary is "Attribuer par scan" and a Save button here would compete with
 * it. Each write carries only the field that moved: the RPC merges inside
 * the key, so a select change landing after a length write still in flight
 * cannot put the old length back. Optimistic like the Journal du jour card:
 * the value moves at once and comes back only if the server said no.
 *
 * The last row is the reader test itself, with the date it last read a card
 * beside the field (markReaderTested writes it): what the reader should
 * read, then what it does read, in one card — a director who set the reader
 * up last month can see it still read a card this morning.
 */
export function BadgesSettingsCard({ settings }: { settings: BadgeSettings }) {
  const t = useTranslations("settings.badges.settings");
  const tc = useTranslations("common");
  const [tagType, setTagType] = useState<TagType>(settings.tagType);
  const [length, setLength] = useState(settings.codeLength === null ? "" : String(settings.codeLength));
  const [lengthInvalid, setLengthInvalid] = useState(false);
  const [, startTransition] = useTransition();
  // The length last accepted by the server (or arriving with the page): a
  // blur that changed nothing does not write, and a refused write goes back
  // to it.
  const committedLength = useRef<number | null>(settings.codeLength);

  function save(patch: BadgeSettingsPatch, revert: () => void) {
    startTransition(async () => {
      const res = await updateBadgeSettings(patch);
      if (res.ok) {
        if (patch.codeLength !== undefined) committedLength.current = patch.codeLength;
        toast.success(tc("toasts.saved"));
      } else {
        revert();
        toast.error(tc("toasts.error"));
      }
    });
  }

  function onTagType(value: string) {
    const next = TAG_TYPES.find((v) => v === value);
    if (!next || next === tagType) return;
    const before = tagType;
    setTagType(next);
    save({ tagType: next }, () => setTagType(before));
  }

  function commitLength() {
    const parsed = parseLength(length);
    if (parsed === undefined) {
      setLengthInvalid(true);
      return;
    }
    setLengthInvalid(false);
    if (parsed === committedLength.current) return;
    const before = committedLength.current;
    save({ codeLength: parsed }, () => setLength(before === null ? "" : String(before)));
  }

  return (
    <SectionCard
      icon={Nfc}
      tone={1}
      title={t("title")}
      hint={t("hint")}
      action={
        <Link
          href="/settings/badges/guide"
          className="inline-flex items-center gap-1 text-sm text-primary"
        >
          {t("guide")}
          <ChevronRight className="size-4 rtl:rotate-180" aria-hidden />
        </Link>
      }
    >
      {/* content-start on each cell: the right one is taller by its hint line,
          and without it the left cell would share that height out between
          its label and its select, dropping the label and stretching the
          trigger past the input beside it. */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid content-start gap-1.5">
          <Label htmlFor="badge-tag-type">{t("tagType")}</Label>
          <Select value={tagType} onValueChange={onTagType}>
            <SelectTrigger id="badge-tag-type" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TAG_TYPES.map((v) => (
                <SelectItem key={v} value={v}>
                  {t(`tagTypes.${v}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid content-start gap-1.5">
          <Label htmlFor="badge-code-length" optional>
            {t("codeLength")}
          </Label>
          {/* A number is an ltr island whatever the page direction; the
              browser's own min/max are the CHECK's bounds, so the spinner
              never offers a value the database refuses. */}
          <Input
            id="badge-code-length"
            type="number"
            inputMode="numeric"
            dir="ltr"
            min={CODE_LENGTH_MIN}
            max={CODE_LENGTH_MAX}
            step={1}
            className="w-28 tabular-nums"
            placeholder="10"
            value={length}
            aria-invalid={lengthInvalid || undefined}
            onChange={(e) => {
              setLength(e.target.value);
              setLengthInvalid(false);
            }}
            onBlur={commitLength}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
          />
          <p className="text-xs text-muted-foreground">
            {lengthInvalid
              ? t("codeLengthInvalid", { min: String(CODE_LENGTH_MIN), max: String(CODE_LENGTH_MAX) })
              : t("codeLengthHint")}
          </p>
        </div>
      </div>

      <ReaderTest testedAt={settings.readerTestedAt} />
    </SectionCard>
  );
}
