import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // Pin the project root. Turbopack infers it by walking up for a lockfile, and
  // there is a stray package-lock.json in the home directory (unrelated, dated
  // March) — so it was resolving the root to /Users/pc and warning on every dev
  // start. An inferred root that sits above the repository also widens what
  // file tracing pulls into a build.
  turbopack: {
    root: __dirname,
  },
  // The media kit is a static page in public/, deliberately UNLISTED: nothing
  // on the site links to it. The rewrite is only so the URL is /media-kit
  // rather than /media-kit.html — it is handed to a rep or a print shop by
  // hand, and a clean one survives being read down a phone.
  //
  // The page carries a noindex meta; the header repeats it because a crawler
  // fetching the file directly may never parse the document.
  async rewrites() {
    return [{ source: "/media-kit", destination: "/media-kit.html" }];
  },
  async headers() {
    return [
      {
        source: "/media-kit:path(.*)",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" }],
      },
    ];
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "qekibejzwpphzzyqigzo.supabase.co" },
    ],
  },
};

export default withNextIntl(nextConfig);
