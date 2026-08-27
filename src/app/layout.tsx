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
  appleWebApp: { capable: true, title: "Rawdati", statusBarStyle: "default" },
  title: { default: "Rawdati — Gestion de crèches et jardins d'enfants", template: "%s · Rawdati" },
  description:
    "La plateforme tout-en-un pour gérer votre crèche ou jardin d'enfants : inscriptions, présences, facturation, comptabilité et communication avec les parents.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();
  const dir = locale === "ar" ? "rtl" : "ltr";

  return (
    <html lang={locale} dir={dir} suppressHydrationWarning>
      <body
        className={`${inter.variable} ${cairo.variable} antialiased ${locale === "ar" ? "font-[family-name:var(--font-cairo)]" : "font-[family-name:var(--font-inter)]"}`}
      >
        <ThemeProvider dir={dir}>
          <NextIntlClientProvider messages={messages}>
            {children}
            <Toaster position={dir === "rtl" ? "bottom-left" : "bottom-right"} richColors />
          </NextIntlClientProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
