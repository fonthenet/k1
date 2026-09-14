import type { Metadata, Viewport } from "next";
import { Inter, Cairo } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const cairo = Cairo({ subsets: ["arabic", "latin"], variable: "--font-cairo" });

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#0e9488" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1f22" },
  ],
};

export const metadata: Metadata = {
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Rawdatik", statusBarStyle: "default" },
  title: { default: "Rawdatik — Gestion de crèches et jardins d'enfants", template: "%s · Rawdatik" },
  description:
    "La plateforme tout-en-un pour gérer votre crèche ou jardin d'enfants : inscriptions, présences, facturation, comptabilité et communication avec les parents.",
};

import { InputModality } from "@/components/shared/input-modality";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();
  const dir = locale === "ar" ? "rtl" : "ltr";

  return (
    <html lang={locale} dir={dir} suppressHydrationWarning>
      <body
        // Cairo sits in the French/English stack as the FALLBACK: Inter has no
        // Arabic glyphs, so an Arabic child's name or the establishment's name
        // inside a French page must fall to Cairo, never to the system face.
        // The stack lives in globals.css (--font-sans) and names "Inter"
        // directly, because next/font's own variable would put its Arial-based
        // "Inter Fallback" in front of Cairo. Inter still draws every Latin
        // glyph first.
        className={`${inter.variable} ${cairo.variable} antialiased ${locale === "ar" ? "font-[family-name:var(--font-cairo)]" : "font-sans"}`}
      >
        <ThemeProvider dir={dir}>
          <NextIntlClientProvider messages={messages}>
            <InputModality />
            {children}
            <Toaster position={dir === "rtl" ? "bottom-left" : "bottom-right"} richColors />
          </NextIntlClientProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
