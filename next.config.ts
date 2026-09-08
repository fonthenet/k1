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
    return [
      { source: "/media-kit", destination: "/media-kit.html" },
      { source: "/guide", destination: "/guide.html" },
      { source: "/quickstart", destination: "/quickstart.html" },
    ];
  },
  async headers() {
    return [
      // Baseline hardening on every route. No page of this app is meant to
      // be shown inside another site's frame — /login, /signup and the
      // enrolment form least of all — so framing is refused outright; the
      // one iframe the app USES (map-embed.tsx, Google Maps / OSM) points
      // outward and is unaffected by frame-ancestors on our own pages.
      //
      // Permissions-Policy names the two device features the app really
      // asks for: the tablet camera for the kiosk scanner and geolocation for
      // the "use my position" button on the map-pin field. Both self only.
      //
      // Deliberately not a full Content-Security-Policy yet: the map iframe,
      // Supabase storage images and next/image would each need an entry, and
      // getting one of them wrong blanks a page silently. That wants a
      // report-only pass of its own.
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(self), geolocation=(self), microphone=()",
          },
        ],
      },
      {
        source: "/:page(media-kit|guide|quickstart):rest(.*)",
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
