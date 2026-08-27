// The locale list, in a module with no directive and no server imports.
//
// It has to live somewhere both sides can reach. `i18n/request.ts` pulls in
// `next/headers`, so a client component cannot import from it; the parent's
// profile form therefore kept its own copy of the array and the profile *page*
// — a server component — imported that copy back. Every export of a
// `"use client"` module is a client reference across the RSC boundary, so what
// the server received was a proxy object, not an array, and the page died on
// `LOCALES.includes is not a function`. One plain module, imported by both,
// makes that impossible.
//
// Language priority for Algeria: Arabic first, English second, French third.
export const LOCALES = ["ar", "en", "fr"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "ar";
