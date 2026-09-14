/**
 * The establishment's badge settings (kg_tenants.settings->'badges', 0165).
 *
 * What kind of tag was bought, how long a card number should be, and when
 * the reader test last read a card. The database checks the shape on the
 * way in; this reads the key back with the same tolerance the CHECK has —
 * every field optional, null where "not set" is the answer — so a tenant
 * born before 0165 reads as "any tag, no expected length, never tested".
 *
 * Its own module, apart from tag-scan.ts, because that one carries the
 * keyboard-wedge HOOK and a server component may not import a module that
 * touches useEffect — the badges page and lookupCard read the settings from
 * the server, the settings card from the client. Pure, no React, tested in
 * scripts/tag-scan.test.mjs beside the parser it serves.
 */
export const TAG_TYPES = ["em125", "nfc", "any"] as const;
export type TagType = (typeof TAG_TYPES)[number];

/** The bounds of an expected number length — the CHECK's (0165). */
export const CODE_LENGTH_MIN = 4;
export const CODE_LENGTH_MAX = 32;

export interface BadgeSettings {
  tagType: TagType;
  /** How many characters a card number should have; null when not set. */
  codeLength: number | null;
  /** When the reader test last read a card (ISO), null when it never has. */
  readerTestedAt: string | null;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export function badgeSettings(settings: unknown): BadgeSettings {
  const b = isRecord(settings) && isRecord(settings.badges) ? settings.badges : null;
  const tagType = TAG_TYPES.find((t) => t === b?.tag_type) ?? "any";
  const len = b?.code_length;
  const codeLength =
    typeof len === "number" && Number.isInteger(len) && len >= CODE_LENGTH_MIN && len <= CODE_LENGTH_MAX
      ? len
      : null;
  const tested = b?.reader_tested_at;
  const readerTestedAt =
    typeof tested === "string" && !Number.isNaN(new Date(tested).getTime()) ? tested : null;
  return { tagType, codeLength, readerTestedAt };
}

/**
 * How a read disagrees with the expected length, or null when it agrees or
 * no length is set. Counted in characters, on the trimmed value — what the
 * database stores — so a reader that pads with spaces is not blamed for
 * them. The reader test prints this in gold: a reader configured for eight
 * hexadecimal digits when the badges were enrolled as ten decimal ones will
 * never open the door, and this line is where a director learns it.
 */
export function lengthMismatch(
  value: string,
  expected: number | null
): { got: number; expected: number } | null {
  if (expected === null) return null;
  const got = [...value.trim()].length;
  return got === expected ? null : { got, expected };
}
