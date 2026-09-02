"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";

/**
 * Last resort: the root layout itself failed, so there is no <html>, no fonts,
 * no NextIntlClientProvider and no theme. This file ships its own document.
 *
 * useTranslations cannot run here (the provider is gone with the layout), so
 * the three languages are inlined. The locale comes from the same kg-locale
 * cookie the request config reads, defaulting to Arabic like the app does. It
 * is read through useSyncExternalStore with an Arabic server snapshot, so the
 * server and client render the same thing first and the cookie's answer
 * replaces it on hydration. Western digits only, as everywhere else.
 */
const COPY = {
  ar: {
    dir: "rtl",
    title: "حدث خطأ ما",
    description: "تعذّر تحميل التطبيق. أعد المحاولة، وإن تكرّر الأمر راسلنا على contact@rawdatik.com.",
    retry: "إعادة المحاولة",
    home: "العودة إلى الرئيسية",
  },
  en: {
    dir: "ltr",
    title: "Something went wrong",
    description: "The application could not be loaded. Try again; if it keeps happening, write to us at contact@rawdatik.com.",
    retry: "Try again",
    home: "Back to home",
  },
  fr: {
    dir: "ltr",
    title: "Une erreur est survenue",
    description: "L'application n'a pas pu être chargée. Réessayez ; si le problème persiste, écrivez-nous à contact@rawdatik.com.",
    retry: "Réessayer",
    home: "Retour à l'accueil",
  },
} as const;

type Locale = keyof typeof COPY;

function localeFromCookie(): Locale {
  const m = /(?:^|; )kg-locale=(ar|en|fr)(?:;|$)/.exec(document.cookie);
  return (m?.[1] as Locale | undefined) ?? "ar";
}

// The cookie never changes while this screen is up, so there is nothing to
// subscribe to; the store exists only to give the server a stable snapshot.
const noop = () => () => {};
const serverLocale = (): Locale => "ar";

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  const locale = useSyncExternalStore(noop, localeFromCookie, serverLocale);
  const c = COPY[locale];

  return (
    <html lang={locale} dir={c.dir}>
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "2rem 1rem",
          fontFamily: "system-ui, sans-serif",
          background: "#f7faf9",
          color: "#0b1f22",
        }}
      >
        <main style={{ maxWidth: "28rem", textAlign: "center" }}>
          <h1 style={{ fontSize: "1.25rem", fontWeight: 700, margin: "0 0 0.5rem" }}>{c.title}</h1>
          <p style={{ margin: "0 0 1.5rem", lineHeight: 1.6, color: "#4b5b5e" }}>{c.description}</p>
          <div style={{ display: "flex", gap: "0.5rem", justifyContent: "center", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={reset}
              style={{
                border: 0,
                borderRadius: "0.75rem",
                padding: "0.6rem 1.1rem",
                background: "#0e9488",
                color: "#fff",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {c.retry}
            </button>
            <Link
              href="/"
              style={{
                borderRadius: "0.75rem",
                padding: "0.6rem 1.1rem",
                border: "1px solid #c9d6d4",
                color: "#0b1f22",
                fontWeight: 600,
                textDecoration: "none",
              }}
            >
              {c.home}
            </Link>
          </div>
        </main>
      </body>
    </html>
  );
}
