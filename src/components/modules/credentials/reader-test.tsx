"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ScanLine } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDate, formatTime } from "@/lib/format";
import { lengthMismatch } from "@/lib/badge-settings";
import { useWedgeCapture } from "@/lib/tag-scan";
import { markReaderTested } from "@/components/modules/settings/badges-settings-actions";
import { lookupCard, type CardLookup } from "./lookup-card";

interface Read {
  id: number;
  /** Exactly what the reader typed, before the database's normalisation. */
  raw: string;
  /** Null while the lookup is in flight. */
  result: CardLookup | null;
}

/** The latest read and the three before it. */
const KEPT_READS = 4;

/**
 * The reader test: a field the USB reader types into, and one line saying
 * what arrived and whose card it is. The last row of the "reader and
 * badges" card — the settings above it say what the reader should read,
 * this row shows what it does read, and the date beside the field says when
 * it last did. It used to be a card of its own above the settings, a header
 * with a field and no body, pointing down at "the card above" — one subject
 * split in two.
 *
 * The field is read-only on purpose. A reader's burst is caught by the
 * keyboard-wedge hook from the keydown events themselves — the characters
 * never need to land in the field — and a person typing a number by hand
 * would only produce a half-shown value that the timing rule then throws
 * away. So the field shows the burst as it arrives and nothing else; the
 * enrolment dialog remains the place where a number is typed by hand.
 *
 * It listens only while it has focus. The badges page can also be armed for
 * "assign by scan", which listens everywhere except inside a field: a card
 * therefore goes to exactly one of the two, decided by where the focus is.
 */
export function ReaderTest({ testedAt }: { testedAt: string | null }) {
  const t = useTranslations("settings.badges.reader");
  const tSettings = useTranslations("settings.badges.settings");
  const tCred = useTranslations("credentials");
  const locale = useLocale();
  const inputRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const [reads, setReads] = useState<Read[]>([]);
  const [, startTransition] = useTransition();
  const seq = useRef(0);
  // "Lecteur testé le" is stamped once per visit, on the first read the
  // server answered: the line is a date, and a director passing twenty
  // cards to check them does not need twenty page refreshes. Beside the
  // field it reads "tested just now" from that moment.
  const marked = useRef(false);
  const [testedNow, setTestedNow] = useState(false);

  // The reader fires the instant a card touches it, so the field is focused
  // before anyone reaches for one. It is deliberately not refocused after a
  // read: a burst only reaches this field while it holds the focus, so the
  // focus is still here when the lookup returns — and when the page's scan
  // mode has blurred it on purpose, a late lookup must not take it back.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function onValue(raw: string) {
    const id = ++seq.current;
    // The line appears at once with what was read; the owner follows when
    // the server answers.
    setReads((prev) => [{ id, raw, result: null }, ...prev].slice(0, KEPT_READS));
    startTransition(async () => {
      const result = await lookupCard(raw);
      setReads((prev) => prev.map((r) => (r.id === id ? { ...r, result } : r)));
      if (result.ok && !marked.current) {
        marked.current = true;
        setTestedNow(true);
        // Best effort: a reader that reads is the fact worth recording; the
        // date line failing to move is not worth a toast over the read.
        await markReaderTested();
      }
    });
  }

  const { buffer } = useWedgeCapture(onValue, { armed: focused, target: inputRef });
  const [latest, ...earlier] = reads;

  /** "Appartient à Adam Amrani (enfant)" — the name on its own bidi island. */
  function owner(result: CardLookup & { ok: true; found: true }) {
    const name = (locale === "ar" && result.nameAr) || result.name || "—";
    return t.rich("belongsTo", {
      name: () => <bdi dir="auto">{name}</bdi>,
      subject: t(`subjects.${result.subjectType}`),
    });
  }

  /** The read's length against the one the establishment set, when it set one. */
  function mismatch(read: Read) {
    return read.result?.ok ? lengthMismatch(read.raw, read.result.expectedLength) : null;
  }

  /**
   * The middle of the read line: how long the read was. Plain when it is
   * the expected length or none is set; gold when it is not — a reader
   * configured for eight hexadecimal digits when the badges were enrolled
   * as ten decimal ones will never open the door, and this is where a
   * director learns it. Digits travel as strings so Arabic keeps them Latin.
   */
  function length(read: Read, brief = false) {
    const m = mismatch(read);
    if (!m) return t("chars", { count: [...read.raw].length });
    const text = t("unexpectedLength", { got: String(m.got), expected: String(m.expected) });
    return brief ? text : <span className="text-gold-ink">{text}</span>;
  }

  /**
   * The second half of the read line. Gold is spent once per line, on the
   * one outcome that needs a person: a card nobody holds yet — unless the
   * length already took it, in which case the wrong reader setting is the
   * thing to look at and the unknown card is said in plain text. The earlier
   * reads below say the same things in fewer words and in muted text.
   */
  function verdict(read: Read, brief = false) {
    const { result } = read;
    if (!result) return <span className="text-muted-foreground">…</span>;
    if (!result.ok) return tCred(`errors.${result.error}`);
    if (!result.found) {
      if (brief) return t("unknownShort");
      return mismatch(read) ? t("unknown") : <span className="text-gold-ink">{t("unknown")}</span>;
    }
    return brief ? owner(result) : <span className="font-medium">{owner(result)}</span>;
  }

  // One row when idle — label, field, the date it last read — and the reads
  // unfold beneath only once a card has been passed.
  const field = (
    <div className="relative w-64 max-w-full" dir="ltr">
      <ScanLine
        className="pointer-events-none absolute inset-y-0 start-3 my-auto size-4 text-muted-foreground"
        aria-hidden
      />
      <Input
        id="reader-test"
        ref={inputRef}
        readOnly
        inputMode="none"
        autoComplete="off"
        // dir="auto": a card number reads left to right, the Arabic
        // placeholder right to left — an ltr box put its full stop first.
        dir="auto"
        // The ring shows on any focus, not only a keyboard one: it is the
        // sign that the field is listening, whatever put the cursor there.
        // Unfocused, the placeholder itself says what to do first.
        className="h-9 ps-9 font-mono focus:border-ring focus:ring-3 focus:ring-ring/50"
        placeholder={focused ? t("placeholder") : t("unfocused")}
        value={buffer}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
    </div>
  );

  /** When the reader last read a card: just now, a date, or never. Muted — a date is a fact. */
  const status = testedNow
    ? tSettings("testedNow")
    : testedAt
      ? tSettings.rich("testedAt", {
          date: formatDate(testedAt, locale),
          time: () => <span dir="ltr">{formatTime(testedAt, locale)}</span>,
        })
      : tSettings("neverTested");

  return (
    <div className="grid content-start gap-1.5 border-t border-border pt-4">
      <Label htmlFor="reader-test">{t("title")}</Label>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {field}
        <p className="text-sm text-muted-foreground">{status}</p>
      </div>
      {latest ? (
        <div className="grid gap-1.5" aria-live="polite">
          <p className="text-sm">
            {t("read")} <span dir="ltr" className="font-mono">{latest.raw}</span>
            {" · "}
            {length(latest)}
            {" · "}
            {verdict(latest)}
          </p>

          {earlier.length > 0 && (
            <ul className="grid gap-0.5 text-xs text-muted-foreground" aria-label={t("recent")}>
              {earlier.map((read) => (
                <li key={read.id}>
                  <span dir="ltr" className="font-mono">{read.raw}</span>
                  {mismatch(read) && (
                    <>
                      {" · "}
                      {length(read, true)}
                    </>
                  )}
                  {" · "}
                  {verdict(read, true)}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{t("hint")}</p>
      )}
    </div>
  );
}
