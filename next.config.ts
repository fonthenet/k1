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
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "qekibejzwpphzzyqigzo.supabase.co" },
    ],
  },
};

export default withNextIntl(nextConfig);
